# noteコメント管理PWA 実装指示書

## 概要

noteクリエイター向けの「受け取ったコメントの返信管理」PWA。
自分の記事に来たコメントのうち、未返信のものを一覧表示し、返信状況を管理する。

### 背景

noteの通知欄はコメントの返信状況が把握しづらい。
「返信済みマーク」「未返信フィルター」がないため、返信漏れが発生しやすい。
この課題をnote APIで解決する。

### 既存プロジェクト「おはヨミ」との関係

おはヨミ（既存PWA）は「自分→他者の記事」への読んだ/コメントした管理ツール。
本PWAは「他者→自分の記事」に来たコメントへの返信管理ツール。
方向が逆のため、別PWAとして実装する。
ただし、CORSプロキシ（Cloudflare Workers）はおはヨミと共有する。

---

## 技術スタック

- **フロントエンド**: HTML + CSS + JavaScript（フレームワーク不要、シングルファイル推奨）
- **ホスティング**: GitHub Pages
- **CORSプロキシ**: Cloudflare Workers（既存のおはヨミ用を拡張）
- **データ永続化**: localStorage（ユーザー設定）+ IndexedDB（コメントキャッシュ）
- **PWA**: Service Worker + manifest.json

---

## note API エンドポイント

すべて認証不要（Cookie不要）のGETリクエスト。
CORSの制約があるため、Cloudflare Workers経由でアクセスする。

### 1. 記事一覧取得

```
GET https://note.com/api/v2/creators/{urlname}/contents?kind=note&page={n}
```

**レスポンス（必要なフィールド）:**
```json
{
  "data": {
    "contents": [
      {
        "id": 147999468,
        "name": "記事タイトル｜おはようカノジョ ＃73",
        "key": "n7afe42275da1",
        "commentCount": 5,
        "likeCount": 27,
        "publishAt": "2026-02-24T07:42:54+09:00",
        "noteUrl": "https://note.com/hasyamo/n/n7afe42275da1",
        "eyecatch": "https://assets.st-note.com/..."
      }
    ],
    "isLastPage": false,
    "totalCount": 77
  }
}
```

**ページネーション**: `isLastPage === true` になるまで `page` をインクリメント。

### 2. コメント一覧取得

```
GET https://note.com/api/v3/notes/{note_key}/note_comments?per_page=10&page=1
```

スレッド表示（子コメント取得）:
```
GET https://note.com/api/v3/notes/{note_key}/note_comments?per_page=10&page=1&parent_key={parent_comment_key}&order=oldest
```

**レスポンス（必要なフィールド）:**
```json
{
  "data": [
    {
      "key": "nc814f7078c025",
      "comment": {
        "type": "root",
        "children": [
          {
            "type": "element",
            "children": [
              { "type": "text", "value": "コメント本文" }
            ],
            "tag_name": "p"
          }
        ]
      },
      "like_count": 1,
      "reply_count": 0,
      "is_creator_replied": false,
      "is_creator_liked": false,
      "is_root": false,
      "created_at": "2026-02-24T08:37:43.220+09:00",
      "user": {
        "key": "fbaef2c001615d02444573a135007008",
        "urlname": "hasyamo",
        "nickname": "はしゃも｜感情構造エンジニア",
        "profile_image_url": "https://assets.st-note.com/..."
      },
      "to_user": {
        "urlname": "ktcrs1107",
        "nickname": "KITAcore｜キタコレ"
      },
      "note_key": "n7afe42275da1"
    }
  ],
  "current_page": 1,
  "next_page": null,
  "total_count": 1
}
```

**重要フィールド:**
- `is_creator_replied`: **クリエイター（記事主）が返信済みかどうか**。これが `false` なら「未返信」
- `is_creator_liked`: クリエイターがコメントにいいねしたか
- `is_root`: ルートコメント（`false` = 子コメント/返信）
- `reply_count`: 返信数
- `user`: コメント投稿者
- `to_user`: 返信先ユーザー（返信コメントの場合）

---

## Cloudflare Workers プロキシ拡張

既存のおはヨミ用プロキシを汎用化する。

### 現在のコード（おはヨミ用）

```javascript
// 省略: 現状は /v2/creators/{id} 固定
```

### 拡張後のコード

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.searchParams.get('path');
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing path parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // ホワイトリストで許可するパスを制限
    const allowed = [
      '/v2/creators/',
      '/v3/notes/',
    ];
    if (!allowed.some(p => path.startsWith(p))) {
      return new Response(JSON.stringify({ error: 'Path not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const noteResponse = await fetch(`https://note.com/api${path}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    
    const data = await noteResponse.json();
    
    return new Response(JSON.stringify(data), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
    });
  },
};
```

**注意**: 既存のおはヨミが `?id=` パラメータで動作している場合、後方互換性を維持する。`path` パラメータがない場合は既存の `id` パラメータにフォールバックする設計にする。

---

## PWA 機能仕様

### 初回設定

1. ユーザーがnoteのurlname（例: `crisp_chimp0823`）を入力
2. localStorageに保存
3. 記事一覧を取得してコメント管理を開始

### メイン画面

**表示内容:**
- 未返信コメント数のバッジ（画面上部）
- コメントがある記事の一覧（commentCount > 0の記事のみ）
- 各記事の下に未返信コメント一覧

**コメントカード表示項目:**
- コメント投稿者のアイコン + ニックネーム
- コメント本文（プレーンテキストに変換）
- 投稿日時（相対表示: 「2時間前」「昨日」など）
- 返信状態バッジ:
  - 🔴 未返信（`is_creator_replied === false`）
  - ✅ 返信済み（`is_creator_replied === true`）
  - ❤️ いいね済み（`is_creator_liked === true`、返信はしていないが反応済み）

### ユーザーアクション

1. **コメントをタップ** → noteの該当コメントへ直接遷移（新しいタブで開く）
   - URL: `https://note.com/{urlname}/n/{note_key}?scrollpos=comment&c={comment_key}`
   - `scrollpos=comment` でコメント欄までスクロール、`c={comment_key}` で該当コメントをハイライト
2. **手動で「返信済み」マーク** → APIの `is_creator_replied` は即時反映されない可能性があるため、ローカルでもマークできるようにする
3. **更新ボタン** → API再取得してコメント一覧をリフレッシュ

### データフロー

```
[ユーザーがPWAを開く]
  ↓
[localStorage から urlname 取得]
  ↓
[Cloudflare Proxy → note API: 記事一覧取得]
  ↓
[commentCount > 0 の記事をフィルタ]
  ↓
[各記事の note_comments API を取得]
  ↓
[is_creator_replied === false のコメントを「未返信」として表示]
  ↓
[IndexedDB にキャッシュ]
```

### データ永続化

- **localStorage**: urlname設定、手動マーク状態
- **IndexedDB**: コメントデータのキャッシュ（オフライン表示用）
- **リセットなし**: おはヨミと違い、日次リセットは行わない。返信済みコメントは表示優先度を下げるだけ

### レート制限への配慮

- 記事一覧は全ページ取得するが、`sleep(500ms)` を挟む
- コメント取得は `commentCount > 0` の記事のみ
- コメント取得も `sleep(300ms)` を挟む
- キャッシュが5分以内なら API を叩かない（Cache-Control に合わせる）
- 記事数が多い場合、直近30日分の記事に絞るオプション

---

## UI/UXデザイン方針

### レイアウト

- モバイルファースト（スマホメイン利用を想定）
- シンプルなカード型レイアウト
- 色使い: 白背景、未返信は赤系バッジ、返信済みは緑系バッジ

### 画面構成

```
┌─────────────────────────┐
│ ⚙️  noteコメント管理     🔄 │  ← ヘッダー（設定 + 更新）
├─────────────────────────┤
│ 未返信: 3件              │  ← サマリー
├─────────────────────────┤
│ 📝 記事タイトル A (2)     │  ← 記事セクション（未返信数）
│ ┌───────────────────┐   │
│ │ 🔴 ユーザーA       │   │  ← 未返信コメントカード
│ │ コメント本文...     │   │
│ │ 2時間前           │   │
│ └───────────────────┘   │
│ ┌───────────────────┐   │
│ │ 🔴 ユーザーB       │   │
│ │ コメント本文...     │   │
│ │ 昨日              │   │
│ └───────────────────┘   │
├─────────────────────────┤
│ 📝 記事タイトル B (1)     │
│ ┌───────────────────┐   │
│ │ 🔴 ユーザーC       │   │
│ │ コメント本文...     │   │
│ │ 3日前             │   │
│ └───────────────────┘   │
├─────────────────────────┤
│ ── 返信済み ──          │  ← 折りたたみ
│ ✅ ユーザーD: ...        │
│ ✅ ユーザーE: ...        │
└─────────────────────────┘
```

### フィルタ

- **デフォルト表示**: 未返信コメントのみ
- **トグル**: 「返信済みも表示」で全コメント表示
- **記事フィルタ**: 直近7日 / 30日 / 全期間

---

## 自クリエイターのコメント除外

自分の記事に来たコメントのうち、自分自身のコメント（返信）は「未返信リスト」から除外する。

判定方法: `comment.user.urlname === 設定した自分のurlname`

---

## コメント本文のパース

APIレスポンスの `comment` フィールドは構造化テキスト。プレーンテキストへの変換が必要。

```javascript
function parseComment(comment) {
  if (!comment || !comment.children) return '';
  return comment.children
    .map(child => {
      if (child.type === 'text') return child.value;
      if (child.children) return parseComment(child);
      return '';
    })
    .join('')
    .replace(/\n+/g, ' ')
    .trim();
}
```

---

## ファイル構成

```
note-comment-manager/
├── index.html          # メインHTML（CSS・JS インライン）
├── manifest.json       # PWA マニフェスト
├── sw.js              # Service Worker
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## 実装の優先順位

### Phase 1（MVP）
1. Cloudflare Workers プロキシの拡張（後方互換性維持）
2. urlname 設定画面
3. 記事一覧取得 → コメント一覧取得 → 未返信表示
4. コメントタップで note 記事を開く

### Phase 2
5. 手動「返信済み」マーク（ローカル）
6. IndexedDB キャッシュ
7. PWA化（Service Worker, manifest）

### Phase 3
8. 通知バッジ（未返信数）
9. 直近N日フィルタ
10. 返信済みコメントの折りたたみ表示

---

## テスト方法

### 動作確認用データ

以下のurlnameで動作確認できる:
- `hasyamo` — 77記事、コメントあり
- `crisp_chimp0823` — 透子さん（提供先ユーザー）

### 確認ポイント

- [ ] urlname設定後、記事一覧が取得できる
- [ ] commentCount > 0 の記事のみ表示される
- [ ] 各記事のコメントが取得・表示される
- [ ] `is_creator_replied === false` のコメントに「未返信」バッジが表示される
- [ ] 自分のコメント（urlnameが一致）が未返信リストから除外される
- [ ] コメントタップでnote記事ページが開く
- [ ] 更新ボタンでデータがリフレッシュされる
- [ ] ページネーション（記事が多い場合）が正しく動作する

---

## 参考情報

- おはヨミ: 既存PWA。GitHub Pages + Cloudflare Workers構成
- note API: 非公式。予告なく仕様変更の可能性あり。レート制限に注意
- `is_creator_replied` フィールド: コメントへの返信判定の根幹。このフィールドの挙動（どのタイミングで true になるか、子コメントの場合の判定）は実際のデータで検証が必要
