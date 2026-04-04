/**
 * Cloudflare Worker — OGPカード配信用
 *
 * おへんじ帖のリンク共有時に、曜日ごとのキャラOGP画像を表示する。
 *
 * URL例:
 *   /ohenjicho?id=xxx            → 今日の曜日のキャラOGP
 *   /ohenjicho?id=xxx&day=mon    → 月曜キャラのOGP
 *
 * - OGPクローラー → OGPメタタグ付きHTMLを返す
 * - ブラウザ      → GitHub Pagesにリダイレクト
 */

const GITHUB_PAGES = 'https://hasyamo.github.io/ohenji-note/'

const DAY_MAP = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const CHIBI_DATA = {
  sun: { name: '日和', line: '全部おへんじできたね。あなたなら大丈夫。' },
  mon: { name: '月子', line: '全件返信、確認しました。完璧ですね。' },
  tue: { name: '陽', line: 'やったー！全部おへんじできたね！' },
  wed: { name: 'しずく', line: 'ゆっくりでいいんだよ。ちゃんと届いてるから。' },
  thu: { name: '凛華', line: 'ふーん、全部返したんだ。まあ、悪くないけど。' },
  fri: { name: 'るな', line: 'ね、ね！全部終わったよ！お祝いしよ！' },
  sat: { name: 'まひる', line: '頑張ったね。あとはゆっくりしよ。' },
}

// OGPクローラーのUser-Agent判定
const CRAWLER_PATTERNS = [
  'Twitterbot',
  'facebookexternalhit',
  'Slackbot',
  'Discordbot',
  'notebot',
  'LineURLPreview',
  'Iframely',
  'curl',
]

function isCrawler(userAgent) {
  if (!userAgent) return false
  return CRAWLER_PATTERNS.some(p => userAgent.includes(p))
}

function getTodayDayName() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  return DAY_NAMES[now.getDay()]
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname !== '/ohenjicho') {
      return new Response('Not Found', { status: 404 })
    }

    const id = url.searchParams.get('id') || ''
    const dayParam = url.searchParams.get('day')
    const day = (dayParam && DAY_MAP[dayParam] !== undefined) ? dayParam : getTodayDayName()

    const userAgent = request.headers.get('User-Agent') || ''

    // ブラウザ → GitHub Pagesにリダイレクト
    if (!isCrawler(userAgent)) {
      const redirectUrl = id ? `${GITHUB_PAGES}?id=${id}` : GITHUB_PAGES
      return Response.redirect(redirectUrl, 302)
    }

    // クローラー → OGPメタタグ付きHTMLを返す
    const ogpImageUrl = `${GITHUB_PAGES}ogp/ogp-${day}.png`
    const chibi = CHIBI_DATA[day]
    const title = 'おへんじ帖'
    const description = `今日の担当は${chibi.name}。「${chibi.line}」noteのコメント返信を管理するツール「おへんじ帖」`

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${ogpImageUrl}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${ogpImageUrl}" />
</head>
<body></body>
</html>`

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  },
}
