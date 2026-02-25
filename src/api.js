import { sleep } from './utils.js'

export const PROXY_URL = 'https://falling-mouse-736b.hasyamo.workers.dev/'

/**
 * Fetch via Cloudflare Workers proxy using ?path= parameter.
 */
async function proxyFetch(path) {
  const url = `${PROXY_URL}?path=${encodeURIComponent(path)}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  return res.json()
}

/**
 * Fetch all articles for a creator, paginating and filtering for commentCount > 0.
 * Calls onProgress(current, total) for UI updates.
 */
export async function fetchAllArticles(urlname, rangeDays, onProgress) {
  const articles = []
  let page = 1
  let isLastPage = false
  const cutoff = rangeDays > 0 ? Date.now() - rangeDays * 86400000 : 0

  while (!isLastPage) {
    if (onProgress) onProgress(`記事一覧を取得中... (${articles.length}件)`)

    const json = await proxyFetch(
      `/api/v2/creators/${encodeURIComponent(urlname)}/contents?kind=note&page=${page}`
    )

    const contents = json.data?.contents || []
    if (contents.length === 0) break

    let reachedCutoff = false
    for (const article of contents) {
      // Skip pinned articles from cutoff check
      if (!article.isPinned && cutoff > 0 && new Date(article.publishAt).getTime() < cutoff) {
        reachedCutoff = true
        break
      }
      if (article.commentCount > 0) {
        articles.push({
          id: article.id,
          key: article.key,
          title: article.name,
          commentCount: article.commentCount,
          publishedAt: article.publishAt,
          urlname: urlname,
        })
      }
    }

    if (reachedCutoff) break

    isLastPage = json.data?.isLastPage ?? true
    page++

    if (!isLastPage) await sleep(500)
  }

  return articles
}

/**
 * Fetch comments for a single note, paginating.
 */
export async function fetchComments(noteKey) {
  const comments = []
  let page = 1

  while (true) {
    const json = await proxyFetch(
      `/api/v3/notes/${encodeURIComponent(noteKey)}/note_comments?per_page=10&page=${page}`
    )

    const data = json.data || []
    if (data.length === 0) break

    comments.push(...data)

    if (!json.next_page) break
    page++
    await sleep(300)
  }

  return comments
}

/**
 * Fetch comments for all articles sequentially.
 * Returns articles enriched with their comments.
 */
export async function fetchAllComments(articles, onProgress) {
  const result = []

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]
    if (onProgress) onProgress(`コメント取得中... (${i + 1}/${articles.length}) ${article.title}`)

    const comments = await fetchComments(article.key)
    result.push({ ...article, comments })

    if (i < articles.length - 1) await sleep(300)
  }

  return result
}

/**
 * Fetch comments with cache diff.
 * Only fetches comments for articles whose commentCount changed.
 */
export async function fetchUpdatedComments(articles, cachedArticles, onProgress) {
  const cacheMap = new Map()
  if (cachedArticles) {
    for (const a of cachedArticles) {
      cacheMap.set(a.key, a)
    }
  }

  const result = []
  let fetchCount = 0
  const toFetch = articles.filter((a) => {
    const cached = cacheMap.get(a.key)
    return !cached || cached.commentCount !== a.commentCount
  })

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]
    const cached = cacheMap.get(article.key)

    if (cached && cached.commentCount === article.commentCount) {
      // Use cached comments
      result.push({ ...article, comments: cached.comments })
    } else {
      // Fetch fresh comments
      fetchCount++
      if (onProgress) onProgress(`コメント取得中... (${fetchCount}/${toFetch.length}) ${article.title}`)

      const comments = await fetchComments(article.key)
      result.push({ ...article, comments })

      if (fetchCount < toFetch.length) await sleep(300)
    }
  }

  return result
}
