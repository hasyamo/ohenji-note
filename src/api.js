import { sleep } from './utils.js'
import { emptyFetchMeta, appendPageLog, markFetchComplete, markFetchPartial, markFetchFailed } from './lib/fetch-meta.js'
import { sortByPublishAtDesc, calcCutoff, isOutsideRange, shouldStopForRange } from './lib/article-range.js'
import { planThreadFetch, shouldRefetchArticle, threadsOf } from './lib/reply-thread.js'

const PROXY_URL = 'https://falling-mouse-736b.hasyamo.workers.dev/'

/**
 * Fetch via Cloudflare Workers proxy using ?path= parameter.
 */
async function proxyFetch(path) {
  const url = `${PROXY_URL}?path=${encodeURIComponent(path)}&source=ohenji-note`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`)
  }
  return res.json()
}

/**
 * Validate that a creator exists by fetching the first page.
 */
export async function validateCreator(urlname) {
  await proxyFetch(`/api/v2/creators/${encodeURIComponent(urlname)}/contents?kind=note&page=1`)
}

/**
 * Fetch all articles for a creator, paginating and filtering for commentCount > 0.
 * Calls onProgress(current, total) for UI updates.
 */
/**
 * 記事一覧をページ取得する。
 * 後方互換のため articles 配列だけを返す。
 * 内部で fetchAllArticlesWithMeta を呼び出す。
 */
export async function fetchAllArticles(urlname, rangeDays, onProgress, options = {}) {
  const { articles } = await fetchAllArticlesWithMeta(urlname, rangeDays, onProgress, options)
  return articles
}

/**
 * 記事一覧を取得し、articles と fetchMeta を返す。
 *
 * fetchMeta.fetchStatus は:
 *   - 'complete' … 最後の isLastPage まで取りきった、または range 内に収まった
 *   - 'partial'  … cutoff(範囲外)で打ち切った、または途中で空ページを得た
 *   - 'failed'   … 例外で停止
 */
export async function fetchAllArticlesWithMeta(urlname, rangeDays, onProgress, options = {}) {
  const { includePinnedOutsideRange = true } = options
  const articles = []
  let page = 1
  let isLastPage = false
  const cutoff = calcCutoff(rangeDays)
  let meta = { ...emptyFetchMeta(), startedAt: new Date().toISOString() }
  let stoppedReason = null

  try {
    while (!isLastPage) {
      if (onProgress) onProgress(`記事一覧を取得中... (${articles.length}件)`)

      const json = await proxyFetch(
        // per=18 は note web の「もっと見る」と同値の安全圏（上限20、超過は0件が返る）
        // 詳細: hasyamo-vault/70_projects/note/guides/note-api.md
        `/api/v2/creators/${encodeURIComponent(urlname)}/contents?kind=note&page=${page}&per=18`
      )

      // ピン留め記事が先頭に固定されて返るため、公開日降順へ正規化してから走査する。
      // これを怠ると古いピン留め記事で期間判定が early break する。
      const contents = sortByPublishAtDesc(json.data?.contents || [])
      const apiIsLastPage = json.data?.isLastPage ?? true

      if (contents.length === 0) {
        meta = appendPageLog(meta, { pageNo: page, articleCount: 0, status: 'empty', nextPage: null })
        stoppedReason = 'empty_page'
        break
      }

      let reachedCutoff = false
      let addedInPage = 0
      for (const article of contents) {
        if (shouldStopForRange(article, cutoff, includePinnedOutsideRange)) {
          reachedCutoff = true
          break
        }
        // 期間外だがピン留め例外で生き残った記事。降順ソート済みなので、
        // ここから先に範囲内の記事は現れない＝この時点で範囲は見終わっている。
        // ただし同一ページ内の後続の例外記事は拾いたいので break せず、
        // 「範囲は終わった」ことだけ記録してページ末尾まで走査を続ける。
        if (isOutsideRange(article, cutoff)) {
          reachedCutoff = true
        }
        if (article.commentCount > 0) {
          articles.push({
            id: article.id,
            key: article.key,
            title: article.name,
            commentCount: article.commentCount,
            publishedAt: article.publishAt,
            urlname: urlname,
            isPinned: !!article.isPinned,
          })
          addedInPage++
        }
      }

      meta = appendPageLog(meta, {
        pageNo: page,
        articleCount: contents.length,
        addedCount: addedInPage,
        nextPage: apiIsLastPage ? null : page + 1,
        status: 'ok',
      })

      if (reachedCutoff) {
        stoppedReason = 'range_cutoff'
        break
      }

      isLastPage = apiIsLastPage
      page++

      if (!isLastPage) await sleep(200)
    }

    // 終了状態を決定
    if (stoppedReason === 'range_cutoff') {
      // 範囲指定での打ち切りは「指定範囲を完全に取れた」とみなして complete 扱い
      meta = markFetchComplete(meta, {
        articleCount: articles.length,
        commentCount: 0,
      })
      meta = { ...meta, stoppedReason: 'range_cutoff' }
    } else if (stoppedReason === 'empty_page' && page === 1) {
      meta = markFetchPartial(meta, {
        articleCount: articles.length,
        commentCount: 0,
        stoppedReason: 'empty_page',
      })
    } else {
      meta = markFetchComplete(meta, {
        articleCount: articles.length,
        commentCount: 0,
      })
    }

    return { ok: true, articles, fetchMeta: meta }
  } catch (err) {
    meta = markFetchFailed(meta, { error: err, phase: 'articles' })
    return { ok: false, articles, fetchMeta: meta }
  }
}

// 2025-09-08 10:00 JST: note.com switched to threaded comments.
// Articles published before this use the legacy flat comments endpoint.
const COMMENT_FORMAT_SWITCH = '2025-09-08T10:00:00+09:00'

export function isLegacyArticle(publishedAt) {
  if (!publishedAt) return false
  return new Date(publishedAt).getTime() < new Date(COMMENT_FORMAT_SWITCH).getTime()
}

// New format: /api/v3/notes/{key}/note_comments
async function fetchCommentsThreaded(noteKey) {
  const comments = []
  let page = 1

  while (true) {
    const json = await proxyFetch(
      `/api/v3/notes/${encodeURIComponent(noteKey)}/note_comments?per_page=100&page=${page}`
    )

    const data = json.data || []
    if (data.length === 0) break

    comments.push(...data)

    if (!json.next_page) break
    page++
    await sleep(200)
  }

  return comments
}

// Replies of one root: parent_key を付けるとスレッド全体（返信への返信も含む）がフラットに返る
async function fetchReplies(noteKey, rootKey) {
  const replies = []
  let page = 1

  while (true) {
    const json = await proxyFetch(
      `/api/v3/notes/${encodeURIComponent(noteKey)}/note_comments?per_page=100&page=${page}&parent_key=${encodeURIComponent(rootKey)}&order=oldest`
    )

    const data = json.data || []
    if (data.length === 0) break

    replies.push(...data)

    if (!json.next_page) break
    page++
    await sleep(200)
  }

  return replies
}

/**
 * スレッドの会話（ルート＋返信）を取得する。会話はキャッシュに持たないので、
 * スレッドを開いたときに呼ぶ。ルートはルート一覧から探す。
 */
export async function fetchThreadConversation(noteKey, rootKey) {
  const replies = await fetchReplies(noteKey, rootKey)
  await sleep(200)
  const roots = await fetchCommentsThreaded(noteKey)
  const root = roots.find((r) => r.key === rootKey) || null
  return { root, replies }
}

/**
 * 新形式の記事のスレッドを組み立てる。
 * reply_count > 0 のルートのうち、キャッシュと reply_count が変わったものだけ返信を取り直す。
 * 返信を取らなくても対応待ちが無いと分かるスレッドは取らない（canSkipReplyFetch）。
 */
async function fetchThreads(noteKey, roots, cachedThreads, ownerUrlname, baseline, onReplyProgress) {
  const { toFetch, reused } = planThreadFetch(roots, cachedThreads, ownerUrlname, { baseline })
  const fetched = []
  for (let i = 0; i < toFetch.length; i++) {
    const root = toFetch[i]
    if (onReplyProgress) onReplyProgress(i + 1, toFetch.length)
    await sleep(200)
    const replies = await fetchReplies(noteKey, root.key)
    fetched.push({ rootKey: root.key, replyCount: root.reply_count, root, replies })
  }
  // ルート一覧の並び（新しい順）に揃える
  const byKey = new Map([...reused, ...fetched].map((t) => [t.rootKey, t]))
  return roots.filter((r) => byKey.has(r.key)).map((r) => byKey.get(r.key))
}

// Legacy format: /api/v3/notes/{key}/comments
// Normalize to threaded shape (comment, is_creator_replied, is_creator_liked, user, key)
// Replied judgement: creator's own comment exists AND no later comment from others.
async function fetchCommentsLegacy(noteKey, ownerUrlname) {
  const raw = []
  let page = 1

  while (true) {
    const json = await proxyFetch(
      `/api/v3/notes/${encodeURIComponent(noteKey)}/comments?per_page=100&page=${page}`
    )
    const data = json.data || []
    if (data.length === 0) break
    raw.push(...data)
    if (!json.next_page) break
    page++
    await sleep(200)
  }

  // Sort ascending by created_at to derive temporal "any later non-owner comment"
  raw.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))

  // Find the latest creator (owner) comment timestamp
  let latestOwnerTs = -Infinity
  for (const c of raw) {
    if (c.user?.urlname === ownerUrlname) {
      const ts = new Date(c.created_at).getTime()
      if (ts > latestOwnerTs) latestOwnerTs = ts
    }
  }

  // For each non-owner comment: replied if owner has commented after it
  // Otherwise unreplied. liked is taken from has_content_creator_liked.
  // We only return non-owner comments (own comments are filtered later in main.js too,
  // but here we also exclude them since we already used them for the timeline).
  const normalized = raw
    .filter((c) => c.user?.urlname !== ownerUrlname)
    .map((c) => {
      const ts = new Date(c.created_at).getTime()
      const replied = ts < latestOwnerTs
      const u = c.user || {}
      return {
        key: c.key,
        body: c.comment,
        comment: c.comment,
        created_at: c.created_at,
        user: {
          ...u,
          // Normalize avatar field name to match threaded format
          profile_image_url: u.profile_image_url || u.user_profile_image_path,
        },
        is_creator_replied: replied,
        is_creator_liked: !!c.has_content_creator_liked,
        _legacy: true,
      }
    })

  return normalized
}

/**
 * Fetch comments for a single note. Picks endpoint based on publishedAt.
 * If `legacyVisible` is false, returns [] for legacy articles.
 */
export async function fetchComments(noteKey, publishedAt, ownerUrlname, legacyVisible = true) {
  if (publishedAt && isLegacyArticle(publishedAt)) {
    if (!legacyVisible) return []
    return fetchCommentsLegacy(noteKey, ownerUrlname)
  }
  return fetchCommentsThreaded(noteKey)
}

/**
 * Fetch comments for all articles sequentially.
 * Returns articles enriched with their comments.
 */
export async function fetchAllComments(articles, ownerUrlname, legacyVisible, onProgress) {
  const result = []

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i]
    if (onProgress) onProgress(`コメント取得中... (${i + 1}/${articles.length}) ${article.title}`)

    const comments = await fetchComments(article.key, article.publishedAt, ownerUrlname, legacyVisible)
    result.push({ ...article, comments })

    if (i < articles.length - 1) await sleep(200)
  }

  return result
}

/**
 * Fetch list of ring user urlnames.
 */
export async function fetchRingUserList() {
  const res = await fetch(`${PROXY_URL}api/ohenjicho/users`)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const json = await res.json()
  return json.userUrlnames || []
}

/**
 * Fetch creator profile (nickname, avatar, urlname).
 */
export async function fetchCreatorProfile(urlname) {
  const json = await proxyFetch(`/api/v2/creators/${encodeURIComponent(urlname)}`)
  const creator = json.data
  return {
    urlname: creator.urlname,
    nickname: creator.nickname,
    avatarUrl: creator.profileImageUrl,
  }
}

/**
 * Opt out from おへんじ帖の輪.
 */
export async function optOutRing(urlname) {
  const res = await fetch(`${PROXY_URL}api/ohenjicho/users/${encodeURIComponent(urlname)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

/**
 * Opt in to おへんじ帖の輪 (re-register).
 */
export async function optInRing(urlname) {
  const res = await fetch(`${PROXY_URL}api/ohenjicho/users/${encodeURIComponent(urlname)}`, {
    method: 'PUT',
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
}

/**
 * Fetch comments with cache diff.
 * Only fetches comments for articles that need it (see shouldRefetchArticle).
 */
export async function fetchUpdatedComments(articles, cachedArticles, ownerUrlname, legacyVisible, onProgress, options = {}) {
  const { result } = await fetchUpdatedCommentsWithMeta(articles, cachedArticles, ownerUrlname, legacyVisible, onProgress, options)
  return result
}

/**
 * コメント取得を行い、result と fetchMeta を返す。
 *
 * 取り直す記事は shouldRefetchArticle で決める（commentCount の変化。更新ボタンのときは対応待ちを含む記事も）。
 * 新形式の記事は、ルートに加えて reply_count が変わったスレッドの返信も取る（article.threads）。
 *
 * options.manualKeys    … 手動で対応済みにしたコメントの key。対応待ちの判定から除く。
 * options.replyBaseline … 返信の追跡を始める取得（初回）。返信は取らず件数だけ記録する。
 * options.refetchPending … 対応待ちの残る記事も取り直すか（更新ボタンのときだけ true。省略時は true）
 *
 * fetchMeta.fetchStatus は:
 *   - 'complete' … 全記事のコメントを取得し終えた（キャッシュ流用含む）
 *   - 'failed'   … 途中で例外が出た。result には取得済みのものまで入る
 */
export async function fetchUpdatedCommentsWithMeta(articles, cachedArticles, ownerUrlname, legacyVisible, onProgress, options = {}) {
  const manualSet = new Set(options.manualKeys || [])
  const replyBaseline = !!options.replyBaseline
  const refetchPending = options.refetchPending !== false
  const cacheMap = new Map()
  if (cachedArticles) {
    for (const a of cachedArticles) {
      cacheMap.set(a.key, a)
    }
  }

  const needsFetch = (article) =>
    shouldRefetchArticle(article, cacheMap.get(article.key), ownerUrlname, {
      legacy: isLegacyArticle(article.publishedAt),
      manualSet,
      refetchPending,
    })

  const result = []
  let fetchCount = 0
  const toFetch = articles.filter(needsFetch)

  let meta = { ...emptyFetchMeta(), startedAt: new Date().toISOString() }

  try {
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      const cached = cacheMap.get(article.key)

      if (!needsFetch(article)) {
        result.push({ ...article, comments: cached.comments, repliedCount: cached.repliedCount, threads: threadsOf(cached) })
        continue
      }

      fetchCount++
      const label = `(${fetchCount}/${toFetch.length}) ${article.title}`
      if (onProgress) onProgress(`コメント取得中... ${label}`)

      const comments = await fetchComments(article.key, article.publishedAt, ownerUrlname, legacyVisible)
      if (isLegacyArticle(article.publishedAt)) {
        result.push({ ...article, comments })
      } else {
        const threads = await fetchThreads(article.key, comments, threadsOf(cached), ownerUrlname, replyBaseline, (n, m) => {
          if (onProgress) onProgress(`返信を取得中... ${label}（スレッド ${n}/${m}）`)
        })
        result.push({ ...article, comments, threads })
      }

      if (fetchCount < toFetch.length) await sleep(200)
    }

    const commentCount = result.reduce((s, a) => s + ((a.comments || []).length), 0)
    meta = markFetchComplete(meta, { articleCount: result.length, commentCount })
    return { ok: true, result, fetchMeta: meta }
  } catch (err) {
    const commentCount = result.reduce((s, a) => s + ((a.comments || []).length), 0)
    meta = markFetchFailed(meta, { error: err, phase: 'comments' })
    meta = { ...meta, articleCount: result.length, commentCount }
    return { ok: false, result, fetchMeta: meta }
  }
}
