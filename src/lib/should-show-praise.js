/**
 * 褒め演出（未返信ゼロのちびキャラ表示）を出すかどうかを判定する純粋関数。
 *
 * 入力:
 *   - articlesWithComments: processComments の出力。各記事に status 付きコメントが入る。
 *   - isRefreshing: データ取得中か
 *   - forceReward: ?reward=1 のデバッグフラグ
 *
 * 出力: 褒め演出を出すべきなら true
 *
 * 仕様:
 *   - 「画面に表示すべきコメント（status !== 'replied'）」が一つもなければ true
 *   - ただし isRefreshing 中は出さない
 *   - forceReward が立っていれば、表示有無に関わらず true（ただし isRefreshing は除く）
 */
export function shouldShowPraise(articlesWithComments, { isRefreshing, forceReward } = {}) {
  if (isRefreshing) return false
  if (forceReward) return true
  const hasVisible = articlesWithComments.some((a) =>
    (a.comments || []).some((c) => c.status !== 'replied')
  )
  return !hasVisible
}
