/**
 * サポートデータ（不具合調査用）を組み立てる純粋関数。
 *
 * 入力:
 *   - input: {
 *       appVersion, buildHash, exportedAt, userAgent,
 *       settings: { urlname, rangeDays, ringVisible, legacyCommentsVisible, viewMode, mutedUsers },
 *       cache: { articles: [...] } | null,
 *       manualRepliedEntries: 新形式エントリ配列,
 *       debugEvents: リングバッファの内容,
 *     }
 *
 * 出力: サポートデータJSONのオブジェクト
 */
import { buildSuspiciousManualGroups } from './manual-replied.js'

export function buildSupportData(input = {}) {
  const {
    appVersion = null,
    buildHash = null,
    exportedAt = new Date().toISOString(),
    userAgent = null,
    settings = {},
    cache = null,
    manualRepliedEntries = [],
    debugEvents = [],
    fetchMeta = null,
  } = input

  const articles = (cache?.articles || []).map((a) => ({
    key: a.key,
    title: (a.title || '').slice(0, 60),
    publishedAt: a.publishedAt,
    commentCount: a.commentCount,
    cachedCommentCount: (a.comments || []).length,
    comments: (a.comments || []).map((c) => ({
      key: c.key,
      user: c.user?.urlname,
      is_creator_replied: c.is_creator_replied,
      is_creator_liked: c.is_creator_liked,
      legacy: !!c._legacy,
    })),
  }))

  const allComments = articles.flatMap((a) => a.comments)
  const manualKeys = new Set(manualRepliedEntries.map((e) => e.key))
  const legacyKeys = new Set(
    manualRepliedEntries.filter((e) => e.source === 'legacy-array-migration').map((e) => e.key)
  )

  const stats = {
    articleCount: articles.length,
    totalComments: allComments.length,
    uniqueCommentKeys: new Set(allComments.map((c) => c.key)).size,
    nullishKeys: allComments.filter((c) => c.key == null || c.key === '').length,
    creatorReplied: allComments.filter((c) => c.is_creator_replied).length,
    creatorLiked: allComments.filter((c) => c.is_creator_liked).length,
    manualRepliedCount: manualRepliedEntries.length,
    manualRepliedLegacyCount: legacyKeys.size,
    manualRepliedKeyInCache: allComments.filter((c) => manualKeys.has(c.key)).length,
    debugEventCount: debugEvents.length,
  }

  return {
    app: {
      appVersion,
      buildHash,
      exportedAt,
      userAgent,
    },
    settings: {
      urlname: settings.urlname ?? null,
      rangeDays: settings.rangeDays ?? null,
      ringVisible: settings.ringVisible ?? null,
      legacyCommentsVisible: settings.legacyCommentsVisible ?? null,
      viewMode: settings.viewMode ?? null,
      mutedUsers: settings.mutedUsers ?? [],
    },
    stats,
    fetchMeta,
    manualReplied: manualRepliedEntries,
    suspiciousGroups: buildSuspiciousManualGroups(manualRepliedEntries),
    debugEvents,
    articles,
  }
}
