/**
 * 取得状態（fetchMeta）と staging→commit 判定の純粋関数群。
 *
 * fetchMeta の形:
 *   {
 *     fetchStatus: 'complete' | 'partial' | 'failed' | 'unknown',
 *     stoppedReason: string | null,
 *     pageCount: number,
 *     articleCount: number,
 *     commentCount: number,
 *     startedAt: string | null,
 *     finishedAt: string | null,
 *     errors: [{ at, message, phase }, ...],
 *     pageLogs: [{ pageNo, articleCount, nextPage, status, error }, ...],
 *     appVersion: string | null,
 *     buildHash: string | null,
 *   }
 */

/**
 * 空の fetchMeta（取得開始前の状態）。
 */
export function emptyFetchMeta() {
  return {
    fetchStatus: 'unknown',
    stoppedReason: null,
    pageCount: 0,
    articleCount: 0,
    commentCount: 0,
    startedAt: null,
    finishedAt: null,
    errors: [],
    pageLogs: [],
    appVersion: null,
    buildHash: null,
  }
}

/**
 * fetchMeta が「信頼できる完全取得」なら true。
 * - fetchStatus === 'complete' のみ true
 * - それ以外（partial / failed / unknown / 無し）は false
 */
export function isReliableFetchMeta(meta) {
  return meta?.fetchStatus === 'complete'
}

/**
 * 取得状態アイコンを更新ボタン横に出すべきかを判定する。
 * - meta が無い場合（初回） → 出さない
 * - complete → 出さない（信頼できる）
 * - partial / failed → 出す
 * - unknown → 出さない（初回扱い）
 */
export function shouldShowFetchWarningIcon(meta) {
  if (!meta) return false
  return meta.fetchStatus === 'partial' || meta.fetchStatus === 'failed'
}

/**
 * 取得結果からキャッシュを上書きすべきか判断する純粋関数。
 *
 * 入力:
 *   - previousCache: 直前まで保存されていたキャッシュ（読み込めなければ null）
 *   - result: {
 *       ok: boolean,           // 取得が例外なく終わったか
 *       fetchMeta,             // 取得状態
 *       articles,              // 取得した記事＋コメント配列
 *     }
 *
 * 出力:
 *   {
 *     action: 'commit' | 'keep' | 'commit-empty',
 *     nextCache: 次に保存すべきキャッシュオブジェクト | null
 *     reason: 判断理由 (string)
 *   }
 *
 * ルール:
 *   - result.ok && fetchStatus==='complete' → commit
 *   - result.ok && fetchStatus==='partial'  → 既存があれば keep、無ければ commit（部分でも初回は保存）
 *   - !result.ok                            → keep（既存があれば）または commit-empty（無ければ空 meta を保存）
 */
export function commitCacheDecision({ previousCache, result, urlname, now }) {
  const meta = result?.fetchMeta || emptyFetchMeta()
  const articles = result?.articles || []
  const hasPrevious = !!(previousCache && Array.isArray(previousCache.articles) && previousCache.articles.length > 0)
  const updatedAt = now || new Date().toISOString()

  if (result?.ok && meta.fetchStatus === 'complete') {
    return {
      action: 'commit',
      nextCache: { urlname, updatedAt, articles, meta },
      reason: 'complete fetch',
    }
  }

  if (result?.ok && meta.fetchStatus === 'partial') {
    if (hasPrevious) {
      return {
        action: 'keep',
        nextCache: {
          ...previousCache,
          meta: {
            ...(previousCache.meta || emptyFetchMeta()),
            lastPartialAttempt: { meta, attemptedAt: updatedAt },
          },
        },
        reason: 'partial fetch, previous cache kept',
      }
    }
    return {
      action: 'commit',
      nextCache: { urlname, updatedAt, articles, meta },
      reason: 'partial fetch, no previous cache, commit anyway',
    }
  }

  // failed
  if (hasPrevious) {
    return {
      action: 'keep',
      nextCache: {
        ...previousCache,
        meta: {
          ...(previousCache.meta || emptyFetchMeta()),
          lastFailedAttempt: { meta, attemptedAt: updatedAt },
        },
      },
      reason: 'failed fetch, previous cache kept',
    }
  }
  return {
    action: 'commit-empty',
    nextCache: { urlname, updatedAt, articles: [], meta },
    reason: 'failed fetch, no previous cache',
  }
}

/**
 * 取得状況のページログを1件追加する純粋関数。
 */
export function appendPageLog(meta, entry) {
  return {
    ...meta,
    pageLogs: [...(meta.pageLogs || []), entry],
    pageCount: (meta.pageLogs || []).length + 1,
  }
}

/**
 * 完了状態に遷移させる。
 */
export function markFetchComplete(meta, { articleCount, commentCount, finishedAt }) {
  return {
    ...meta,
    fetchStatus: 'complete',
    stoppedReason: null,
    articleCount,
    commentCount,
    finishedAt: finishedAt || new Date().toISOString(),
  }
}

/**
 * 部分取得状態に遷移させる。途中で打ち切ったとき。
 */
export function markFetchPartial(meta, { articleCount, commentCount, stoppedReason, finishedAt }) {
  return {
    ...meta,
    fetchStatus: 'partial',
    stoppedReason: stoppedReason || 'unknown',
    articleCount,
    commentCount,
    finishedAt: finishedAt || new Date().toISOString(),
  }
}

/**
 * 2つの fetchMeta（記事取得とコメント取得など）を合成する。
 * fetchStatus の優先順位: failed > partial > complete > unknown
 * pageLogs / errors は両方を連結する。
 */
export function mergeFetchMeta(a, b) {
  const m1 = a || emptyFetchMeta()
  const m2 = b || emptyFetchMeta()
  const order = { complete: 0, unknown: 0, partial: 1, failed: 2 }
  const worseStatus = [m1.fetchStatus, m2.fetchStatus].sort((x, y) => (order[y] || 0) - (order[x] || 0))[0]
  return {
    fetchStatus: worseStatus,
    stoppedReason: m2.stoppedReason || m1.stoppedReason || null,
    pageCount: (m1.pageCount || 0) + (m2.pageCount || 0),
    articleCount: m2.articleCount || m1.articleCount || 0,
    commentCount: m2.commentCount || m1.commentCount || 0,
    startedAt: m1.startedAt || m2.startedAt || null,
    finishedAt: m2.finishedAt || m1.finishedAt || null,
    errors: [...(m1.errors || []), ...(m2.errors || [])],
    pageLogs: [...(m1.pageLogs || []), ...(m2.pageLogs || [])],
    appVersion: m1.appVersion || m2.appVersion || null,
    buildHash: m1.buildHash || m2.buildHash || null,
  }
}

/**
 * 失敗状態に遷移させる。例外で止まった時。
 */
export function markFetchFailed(meta, { error, finishedAt, phase }) {
  const errorEntry = {
    at: new Date().toISOString(),
    message: error?.message || String(error),
    phase: phase || 'unknown',
  }
  return {
    ...meta,
    fetchStatus: 'failed',
    stoppedReason: errorEntry.message,
    errors: [...(meta.errors || []), errorEntry],
    finishedAt: finishedAt || new Date().toISOString(),
  }
}
