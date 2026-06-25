/**
 * キャッシュの保存判定・エラー分類の純粋関数。
 *
 * - 保存失敗（QuotaExceeded 等）は握りつぶさず、結果オブジェクトとして返す
 * - 保存サイズも計測してメタに含める
 */

export const CURRENT_CACHE_SCHEMA_VERSION = 2
export const CACHE_MODE = 'actionable-comments-only'

/**
 * Error 名から保存失敗の理由を分類する。
 * - QuotaExceededError, NS_ERROR_DOM_QUOTA_REACHED → 'quota_exceeded'
 * - SecurityError → 'security'
 * - その他 → 'storage_error'
 */
export function classifyStorageError(error) {
  const name = error?.name || ''
  const code = error?.code
  if (name === 'QuotaExceededError') return 'quota_exceeded'
  if (name === 'NS_ERROR_DOM_QUOTA_REACHED') return 'quota_exceeded'
  if (code === 22 || code === 1014) return 'quota_exceeded'
  if (name === 'SecurityError') return 'security'
  return 'storage_error'
}

/**
 * UTF-8 換算のバイト数を概算する。
 */
export function approxByteLength(str) {
  if (typeof str !== 'string') return 0
  if (typeof Blob === 'function') {
    try { return new Blob([str]).size } catch {}
  }
  // フォールバック: 簡易UTF-8概算
  let bytes = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c < 0xd800 || c >= 0xe000) bytes += 3
    else { bytes += 4; i++ }
  }
  return bytes
}

/**
 * 「対応対象キャッシュ」用にコメントをフィルタする。
 * - 自分のコメントは除外
 * - 作者返信済み (is_creator_replied) は除外
 * - それ以外（未返信／いいね済）は残す
 *
 * 同時に、記事ごとに「返信済み件数」(repliedCount) を集計してフィールドに残す。
 * これは満足感の表示（返信済み 242件）のためにキャッシュに保持する数値（本文なし）。
 *
 * 入力: 記事の配列、所有者の urlname
 * 出力: フィルタ済みの記事配列。各記事に repliedCount を含む。
 */
export function filterActionableComments(articles, ownerUrlname) {
  if (!Array.isArray(articles)) return []
  return articles.map((a) => {
    const all = a.comments || []
    const others = all.filter((c) => c && c.user?.urlname !== ownerUrlname)
    const actionable = others.filter((c) => !c.is_creator_replied)
    // is_creator_replied: true のコメントが others に含まれていた場合 = 新規取得
    // 含まれない場合 = 既にフィルタ済みのキャッシュ流用なので、元の repliedCount を尊重
    const hasRepliedInPayload = others.some((c) => c.is_creator_replied)
    const repliedCount = hasRepliedInPayload
      ? others.filter((c) => c.is_creator_replied).length
      : (a.repliedCount ?? 0)
    return {
      ...a,
      comments: actionable,
      repliedCount,
    }
  })
}

/**
 * キャッシュオブジェクトを保存用に整える（schemaVersion / cacheMode / cacheSize を埋める）。
 * 保存はしない。純粋関数。
 */
export function prepareCacheForSave(nextCache) {
  if (!nextCache) return { cache: null, json: null, sizeBytes: 0 }
  const withSchema = {
    schemaVersion: CURRENT_CACHE_SCHEMA_VERSION,
    cacheMode: CACHE_MODE,
    ...nextCache,
    meta: {
      ...(nextCache.meta || {}),
      schemaVersion: CURRENT_CACHE_SCHEMA_VERSION,
      cacheMode: CACHE_MODE,
    },
  }
  const json = JSON.stringify(withSchema)
  const sizeBytes = approxByteLength(json)
  // size を meta にも残しておく（保存できた場合の確認用）
  withSchema.meta.cacheSizeBytes = sizeBytes
  const jsonWithSize = JSON.stringify(withSchema)
  return { cache: withSchema, json: jsonWithSize, sizeBytes }
}

/**
 * 「前のキャッシュの記事を流用していいか」を判定する純粋関数。
 *
 * 入力:
 *   - cache: 前回のキャッシュ全体
 *   - oldArticle: cache 内の対応する記事
 *   - newArticle: 今回 fetchAllArticles で取得した記事
 *   - storageStatus: 前回の保存結果（'saved' | 'failed' | undefined）
 *
 * 流用条件:
 *   - cache.meta.fetchStatus === 'complete'
 *   - storageStatus === 'saved'（保存成功している）
 *   - schemaVersion が一致
 *   - oldArticle.commentCount === newArticle.commentCount
 */
export function canReuseArticleCache({ cache, oldArticle, newArticle, storageStatus }) {
  if (!cache || !oldArticle || !newArticle) return false
  if (cache.meta?.fetchStatus !== 'complete') return false
  if (storageStatus !== 'saved') return false
  if (cache.schemaVersion !== CURRENT_CACHE_SCHEMA_VERSION) return false
  if (oldArticle.commentCount !== newArticle.commentCount) return false
  return true
}
