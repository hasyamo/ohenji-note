/**
 * 記事一覧の取得範囲まわりの純粋関数。
 *
 * note の REST `/api/v2/creators/{urlname}/contents` には既知の罠があり、
 * page=1 の先頭にピン留め記事が固定されるため、contents[] の素の並び順は
 * 公開日の降順ではない。取得処理がこの並び順に依存しないよう、
 * ページ単位で正規化してから走査する。
 *
 * 詳細: hasyamo-vault/70_projects/note/guides/note-api.md「ピン留め記事の罠」
 */

/**
 * ページ内の記事を publishAt 降順に正規化する。
 *
 * ピン留め記事が先頭に固定されて返るため、これを行わないと
 * 期間判定が「古いピン留め記事」に先に当たって早期停止する。
 *
 * @param {Array} contents - note API が返した contents[]
 * @returns {Array} publishAt 降順の新しい配列（入力は破壊しない）
 */
export function sortByPublishAtDesc(contents) {
  return [...(contents || [])].sort(
    (a, b) => new Date(b.publishAt).getTime() - new Date(a.publishAt).getTime()
  )
}

/**
 * rangeDays からカットオフのタイムスタンプを求める。
 * rangeDays が 0 以下（＝「すべて」）なら 0 を返し、期間判定なしを意味する。
 *
 * @param {number} rangeDays
 * @param {number} [now] - 基準時刻。省略時は現在時刻
 * @returns {number} カットオフの epoch ms。0 なら期間判定なし
 */
export function calcCutoff(rangeDays, now = Date.now()) {
  return rangeDays > 0 ? now - rangeDays * 86400000 : 0
}

/**
 * 記事が取得範囲より前かどうか。
 *
 * @param {object} article - publishAt を持つ記事
 * @param {number} cutoff - calcCutoff() の戻り値
 * @returns {boolean}
 */
export function isOutsideRange(article, cutoff) {
  if (!(cutoff > 0)) return false
  return new Date(article.publishAt).getTime() < cutoff
}
