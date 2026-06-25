/**
 * 単一コメントの状態を判定する。
 *
 * 入力:
 *   - comment: { is_creator_replied, is_creator_liked, key, ... }
 *   - index: { all: Set<string>, legacy: Set<string> } - manualReplied のインデックス
 *
 * 出力:
 *   'replied_api'           … note.com側で作者が返信済み
 *   'replied_manual'        … アプリの「返信した」ボタンで印を付けた（通常）
 *   'replied_manual_legacy' … 旧形式の手動印を移行したもの（信頼度低）
 *   'liked'                 … note.com側で作者がいいねだけしている
 *   'unreplied'             … 上記いずれにも当たらない
 *
 * 優先順位は上から順。
 */
export function getCommentStatus(comment, index = { all: new Set(), legacy: new Set() }) {
  if (comment?.is_creator_replied) return 'replied_api'
  if (comment?.key && index.all.has(comment.key)) {
    if (index.legacy.has(comment.key)) return 'replied_manual_legacy'
    return 'replied_manual'
  }
  if (comment?.is_creator_liked) return 'liked'
  return 'unreplied'
}

/**
 * 5値の詳細ステータスを、画面表示用の3値（replied/liked/unreplied）に集約する。
 * 既存の processComments の挙動を維持するための薄い変換層。
 */
export function toCoarseStatus(detailedStatus) {
  if (detailedStatus === 'replied_api' || detailedStatus === 'replied_manual' || detailedStatus === 'replied_manual_legacy') {
    return 'replied'
  }
  return detailedStatus
}
