# おへんじ帖 ちびキャラ画像仕様書

## 概要

おへんじ帖PWAの「すべて返信済み」画面に表示する、曜日別ちびキャライラスト。
コメント返信を全て完了したユーザーへのご褒美演出。

---

## 画像仕様

| 項目 | 仕様 |
|------|------|
| 枚数 | 7枚（月〜日、各キャラ1枚） |
| サイズ | 300×300px |
| 形式 | PNG（透過背景） |
| テイスト | 2〜3頭身デフォルメ |
| 衣装 | 彼シャツ（おはカノ本編と統一） |
| セリフ | なし（画像のみ） |

---

## キャラ別ポーズ・表情

| 曜日 | キャラ | 外見の特徴 | ポーズ | 表情 |
|------|--------|-----------|-------|------|
| 月 | 月子 | 黒ロングストレート、ワインレッドフレームの丸メガネ、青い瞳 | メガネを直しながら小さく拍手 | 控えめな微笑み |
| 火 | 陽 | ダークブラウンのショートボブ、オレンジブラウンの瞳 | 両手を上げてバンザイ | 満面の笑み |
| 水 | しずく | ダークブルーブラックのセミロング、琥珀色の瞳 | 両手を胸の前で合わせてほっとした顔 | 穏やかな笑顔 |
| 木 | 凛華 | 黒髪ウルフカットボブ、琥珀色の瞳 | 腕組みしながらフイッと横を向く | 照れ隠し（ツンデレ） |
| 金 | るな | 金髪ハイポニーテール、緑の瞳 | ピースサイン＋軽くジャンプ | 元気いっぱいの笑顔 |
| 土 | まひる | ダークブラウンのお団子ヘア、茶色の瞳 | ゆるく手を振る | のんびりした笑顔 |
| 日 | 日和 | ダークブラウンのサイド三つ編み、紫の瞳 | 両手を前で重ねて小さくお辞儀 | 温かいお姉さんの笑顔 |

---

## Gemini プロンプト

### 共通プロンプト（全キャラ共通部分）

```
Generate a cute chibi anime character illustration.

Style requirements:
- 2-3 head tall chibi/super-deformed proportions
- Cute, rounded face with large expressive eyes
- Simple but recognizable features
- Clean lineart with soft coloring
- Transparent background (no background elements)
- The character is wearing an oversized white boyfriend shirt (彼シャツ) as a one-piece, barefoot
- 300x300 pixel output size
- Consistent art style across all 7 characters (this is important)

DO NOT include any text, speech bubbles, or decorative elements.
DO NOT include any background. The character should be on a completely transparent/white background.
```

### 月曜：月子（Tsukiko）

```
{共通プロンプト}

Character: Tsukiko (Monday)
- Long straight black hair, shiny and smooth
- Round glasses with wine-red frames
- Blue clear eyes
- Pose: adjusting her glasses with one hand while giving a small clap with the other hand
- Expression: gentle, reserved smile with a hint of pride
- Personality comes through: intellectual, reliable
```

### 火曜：陽（You）

```
{共通プロンプト}

Character: You (Tuesday)
- Short fluffy bob hair, dark brown with light highlights
- Orange-brown sparkling eyes
- Pose: both arms raised up in a cheerful banzai/celebration pose
- Expression: big bright smile, radiating energy and joy
- Personality comes through: energetic mood-maker
```

### 水曜：しずく（Shizuku）

```
{共通プロンプト}

Character: Shizuku (Wednesday)
- Semi-long dark blue-black hair with loose waves, hair past shoulders
- Amber/golden eyes
- Pose: both hands gently clasped together in front of chest, relieved posture
- Expression: soft, peaceful smile, calm and comforting
- Personality comes through: healing, gentle presence
```

### 木曜：凛華（Rinka）

```
{共通プロンプト}

Character: Rinka (Thursday)
- Black wolf-cut bob hair, messy and layered, hair flicking outward
- Amber/golden sharp eyes
- Pose: arms crossed, face turned slightly away (tsundere pose)
- Expression: slight smirk, blushing cheeks, trying to hide being impressed
- Personality comes through: tsundere, cool but secretly caring
```

### 金曜：るな（Runa）

```
{共通プロンプト}

Character: Runa (Friday)
- Long golden blonde hair in a high ponytail with a hair ribbon
- Bright green sparkling eyes
- Pose: one hand making a peace sign, slight jump with one foot off the ground
- Expression: bright cheerful grin, full of excitement
- Personality comes through: energetic, fun-loving
```

### 土曜：まひる（Mahiru）

```
{共通プロンプト}

Character: Mahiru (Saturday)
- Dark brown hair in a loose messy bun, with strands falling down
- Soft warm brown eyes
- Pose: gently waving one hand in a relaxed manner
- Expression: soft, sleepy but happy smile, relaxed
- Personality comes through: laid-back, peaceful weekend vibes
```

### 日曜：日和（Hiyori）

```
{共通プロンプト}

Character: Hiyori (Sunday)
- Dark brown hair in a long side braid over shoulder, with loose strands framing face
- Soft purple gentle eyes
- Pose: both hands placed together in front, giving a slight graceful bow
- Expression: warm, loving big-sister smile
- Personality comes through: gentle, nurturing, gives energy for the new week
```

---

## 実装仕様（PWA側）

### 画像ファイル名

```
icons/chibi-mon.png   # 月子
icons/chibi-tue.png   # 陽
icons/chibi-wed.png   # しずく
icons/chibi-thu.png   # 凛華
icons/chibi-fri.png   # るな
icons/chibi-sat.png   # まひる
icons/chibi-sun.png   # 日和
```

### 表示ロジック

```javascript
function getChibiImage() {
  const dayIndex = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })
  ).getDay();
  
  const images = [
    'icons/chibi-sun.png',  // 0: Sunday
    'icons/chibi-mon.png',  // 1: Monday
    'icons/chibi-tue.png',  // 2: Tuesday
    'icons/chibi-wed.png',  // 3: Wednesday
    'icons/chibi-thu.png',  // 4: Thursday
    'icons/chibi-fri.png',  // 5: Friday
    'icons/chibi-sat.png',  // 6: Saturday
  ];
  
  return images[dayIndex];
}
```

### 表示条件

- 「すべて返信済み」状態（未返信コメントが0件）のときのみ表示
- 画面中央に配置（縦方向はやや上寄り）
- `max-width: 200px` でレスポンシブ対応（300px画像を縮小表示）

### CSS例

```css
.chibi-reward {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
}

.chibi-reward img {
  max-width: 200px;
  height: auto;
  opacity: 0;
  animation: fadeIn 0.5s ease-in forwards;
}

@keyframes fadeIn {
  to { opacity: 1; }
}
```

---

## 生成時の注意

- 7枚すべて同じアートスタイルで統一すること（Geminiに参照画像として1枚目を渡すと良い）
- 彼シャツは白のオーバーサイズシャツで統一
- 透過背景が出ない場合は白背景で生成し、後で背景除去ツールで処理
- 2〜3頭身のバランスが崩れやすいので、生成後に確認して必要なら再生成
