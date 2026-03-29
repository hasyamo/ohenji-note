# おへんじ帖 追加機能 実装指示書

既存の `instruction-note-comment-manager.md` に対する追加実装。
以下の3機能を追加する。

---

## 1. おへんじ帖の輪（ユーザー一覧機能）

### 概要

おへんじ帖を使っているユーザーが互いに見つけられる機能。
コメントを大切にするクリエイター同士が自然に繋がる仕組み。

### Cloudflare Workers 側の変更

#### KV ストレージ

Cloudflare KV に以下の形式でユーザー情報を保存する。

```
キー: ohenjicho:users:{userId}
値（JSON）:
{
  "userId": "12345678",
  "registeredAt": "2026-03-14T10:00:00Z",
  "optOut": false
}
```

#### ユーザー登録（既存プロキシに追記）

既存のプロキシ処理に追記する形で実装する（新しいWorkerは作らない）。
note APIへのリクエストURLからユーザーIDを抽出してKVに保存する。

```javascript
// URLパターン例: /api/v2/creators/{userId}/contents
// または: /api/v2/notes?userId={userId}

async function extractAndSaveUserId(url, kv) {
  // URLからuserIdを抽出するロジック
  const match = url.match(/creators\/(\d+)/) || url.match(/userId=(\d+)/);
  if (!match) return;
  
  const userId = match[1];
  const key = `ohenjicho:users:${userId}`;
  
  // 既存エントリのoptOutを確認（optOut=trueなら保存しない）
  const existing = await kv.get(key, 'json');
  if (existing?.optOut === true) return;
  
  // 新規または更新
  await kv.put(key, JSON.stringify({
    userId,
    registeredAt: existing?.registeredAt || new Date().toISOString(),
    optOut: false
  }));
}
```

#### エンドポイント追加

**GET `/api/ohenjicho/users`**
- KVに保存された全ユーザーID一覧を返す（optOut=falseのみ）
- レスポンス: `{ "userIds": ["12345678", "87654321", ...] }`

**DELETE `/api/ohenjicho/users/{userId}`**
- 指定ユーザーのoptOutをtrueに更新（KVからは削除せず、フラグのみ変更）
- PWA側から設定OFFにしたとき呼ばれる

### PWA 側の変更

#### ヘッダーアイコン追加

現在のヘッダー右上に「おへんじ帖の輪」ボタンを追加する。
アイコンは lucide-react の `Users` または `Link` を使用。
現在の更新アイコン・設定アイコンと並べて3つにする。

```
[おへんじ帖]  [更新] [輪] [設定]
```

#### おへんじ帖の輪 画面

ヘッダーの輪アイコンをタップで表示する。

1. `/api/ohenjicho/users` からユーザーID一覧を取得
2. 各ユーザーIDに対して note API `/api/v2/creators/{userId}` を呼び、以下を取得：
   - `urlname`（ユーザー名）
   - `nickname`（表示名）
   - `userProfileImagePath`（アバター画像URL）
3. 一覧をカード形式で表示
4. カードをタップで `https://note.com/{urlname}` を新しいタブで開く

**表示項目（1カードあたり）：**
- アバター画像
- 表示名（nickname）
- @urlname

**注意：**
- ユーザーID一覧の取得後、creator情報の取得はレート制限を避けるため順次処理（並列は避ける）
- 取得失敗したユーザーはスキップして表示しない

#### 設定画面への追加

既存の設定画面に以下のトグルを追加する。

```
おへんじ帖の輪に表示する  [ON / OFF]
```

- デフォルト: ON
- OFFに切り替えたとき: `/api/ohenjicho/users/{userId}` にDELETEリクエストを送信
- ONに切り替えたとき: 次回プロキシ経由でAPI呼び出しが走った際に自動で再登録される

設定はlocalStorageに保存する（キー: `ohenjicho_ring_visible`）。

---

## 2. バージョンアップ通知モーダル

### 概要

アプリのバージョンが上がったとき、起動時に一度だけお知らせを表示する。

### 実装

アプリ内に `CURRENT_VERSION` 定数を持つ。

```javascript
const CURRENT_VERSION = '1.1.0'; // 今回のアップデートで 1.0.0 → 1.1.0 に上げる
```

起動時に localStorage の `lastSeenVersion` と比較する。

```javascript
function checkVersionUpdate() {
  const lastSeen = localStorage.getItem('lastSeenVersion');
  if (lastSeen !== CURRENT_VERSION) {
    showUpdateModal(lastSeen);
  }
}

function onModalClose() {
  localStorage.setItem('lastSeenVersion', CURRENT_VERSION);
}
```

### モーダルの表示内容

初回起動時（`lastSeenVersion` が null）はモーダルを表示しない。
バージョンが上がった場合のみ表示する。

```
━━━━━━━━━━━━━━━━
  おへんじ帖 アップデート
━━━━━━━━━━━━━━━━

おへんじ帖を使ってるユーザが繋がれるように、
「おへんじ帖の輪」を追加しました。

公開したくない人は設定画面より
非公開を選択してね。

        [  とじる  ]
```

- モーダルを閉じたとき `lastSeenVersion` を更新
- 次回起動時は表示しない

---

## 3. バージョン管理

`CURRENT_VERSION` の更新ルール：
- 機能追加時: マイナーバージョンを上げる（例: 1.0.0 → 1.1.0）
- バグ修正のみ: パッチバージョンを上げる（例: 1.1.0 → 1.1.1）
- バージョンアップ通知を出したいときだけ `CURRENT_VERSION` を更新する

---

## デプロイ手順（本番ユーザーへの影響を避けるため）

現在おへんじ帖を使っているユーザーがいる状態でWorkerを変更するため、
本番Workerを直接編集せず、以下の手順でテストしてから切り替える。

### 手順

**1. ステージング用Workerを別名で作成**

```bash
# wrangler.toml に staging 環境を追加
[env.staging]
name = "ohenji-note-proxy-staging"
```

または単純に別Workerとしてデプロイ：
```bash
wrangler deploy --name ohenji-note-proxy-staging
```

デプロイ後のURL例：
- 本番: `https://ohenji-note-proxy.{account}.workers.dev`
- ステージング: `https://ohenji-note-proxy-staging.{account}.workers.dev`

**2. PWAをローカルでステージングWorkerに向ける**

PWAのWorker URLを環境変数または定数で管理している場合、
ローカル起動時だけステージングURLに向けて動作確認する。

```javascript
// 開発時のみ変更（コミットしない）
const WORKER_BASE_URL = 'https://ohenji-note-proxy-staging.{account}.workers.dev';
```

**3. テスト確認ポイント（後述）をすべて通過したら本番Workerに適用**

```bash
wrangler deploy --name ohenji-note-proxy
```

**4. ステージングWorkerは削除またはそのまま放置でOK**

### 注意
- ステージングWorkerのKVは本番KVとは別に設定すること（本番データを汚さない）
- wrangler.toml で `kv_namespaces` を環境ごとに分ける

```toml
[[kv_namespaces]]
binding = "KV"
id = "本番のKV ID"

[env.staging]
[[env.staging.kv_namespaces]]
binding = "KV"
id = "ステージング用KV ID（新規作成）"
```

---

## テスト確認ポイント

### おへんじ帖の輪
- [ ] プロキシ経由でAPI呼び出しすると、KVにユーザーIDが保存される
- [ ] `/api/ohenjicho/users` でoptOut=falseのユーザー一覧が取得できる
- [ ] 設定でOFFにすると、DELETEリクエストが飛ぶ
- [ ] 輪アイコンタップでユーザー一覧が表示される
- [ ] カードタップでnoteクリエイターページが開く
- [ ] 自分自身も一覧に表示される（問題ない）

### バージョンアップ通知
- [ ] 初回起動時はモーダルが出ない
- [ ] バージョンが上がった状態で起動するとモーダルが出る
- [ ] モーダルを閉じると次回起動時は出ない
- [ ] localStorageをクリアするとまた出る（初回扱いになるため出ない）
