import { buildThreadItem, threadsOf } from './reply-thread.js'

/**
 * キャッシュ＋手動印リスト＋設定 から画面表示用配列を作る純粋関数。
 *
 * 入力:
 *   - articles: キャッシュ内の記事配列。各 article は { comments: [...] } を持つ。
 *   - urlname: 自分の note ユーザー名。これと一致する投稿者のコメントは除外。
 *   - manualReplied: 「対応済みにする」ボタンで印を付けたコメント・返信の key の配列。
 *   - mutedUrlnames: 非表示にしたユーザーの urlname の配列。
 *   - replyTrackingSince: 返信の追跡開始時刻。これ以前の返信は判定対象にしない。
 *
 * 出力: 各記事の comments に status を付与し、未返信件数を集計した配列。
 *   返信スレッドのうち対応待ちの返信があるものは、kind: 'thread' の項目として
 *   ルートコメントと同じ comments 配列に並べる（1スレッド＝1項目）。
 *   コメントが1件もない記事は除外し、公開日新しい順に並べる。
 */
export function processComments(articles, urlname, manualReplied = [], mutedUrlnames = [], replyTrackingSince = null) {
  const manualSet = new Set(manualReplied)
  const mutedSet = new Set(mutedUrlnames)

  return articles
    .map((article) => {
      const otherComments = (article.comments || []).filter(
        (c) => c.user && c.user.urlname !== urlname && !mutedSet.has(c.user.urlname)
      )

      const classified = otherComments.map((c) => ({
        ...c,
        status: classifyComment(c, manualSet),
      }))

      for (const thread of threadsOf(article) || []) {
        const item = buildThreadItem(thread, urlname, manualSet, mutedSet, replyTrackingSince)
        if (item) classified.push(item)
      }

      const order = { unreplied: 0, liked: 1, replied: 2 }
      classified.sort((a, b) => order[a.status] - order[b.status])

      return {
        ...article,
        comments: classified,
        unrepliedCount: classified.filter((c) => c.status !== 'replied').length,
      }
    })
    .filter((a) => a.comments.length > 0 || (a.repliedCount || 0) > 0)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
}

/**
 * 単一コメントのステータスを判定する。
 * 優先順位: replied > liked > unreplied
 */
export function classifyComment(comment, manualSet) {
  if (comment.is_creator_replied || manualSet.has(comment.key)) return 'replied'
  if (comment.is_creator_liked) return 'liked'
  return 'unreplied'
}
