/**
 * 返信スレッド（ルートコメントの下に続く返信）の純粋関数群。
 *
 * note API の返信は2段まで。ルートの parent_key で取ると、スレッド全体がフラットに返る。
 * 返信の is_creator_replied は常に false なので判定に使えない。代わりに
 * to_user（返信先）と、その後に記事主の返信があるかどうかで判定する。
 *
 * thread の形（取得直後）:
 *   { rootKey, replyCount, root, replies: [...] }
 * キャッシュでは会話を持たない。記事ごとに次の2つだけを保存する（compactThreads）:
 *   replyCounts:    { [rootKey]: reply_count }            … 返信のある全ルート
 *   pendingReplies: { [rootKey]: [対応待ちの返信, ...] }   … 対応待ちがあるスレッドだけ
 * 読むときは threadsOf で { rootKey, replyCount, pending? } の配列に戻す。
 *
 * 追跡開始時刻（replyTrackingStartedAt）:
 *   返信の見逃し判定は、v2 を初めて使った時刻より後に付いた返信だけを対象にする。
 *   それ以前の返信は「既存」として未返信件数に入れない（初回に過去分が一気に未返信化しないように）。
 *   判定の順は 1. 追跡開始後の返信か 2. 読者→記事主の返信か 3. その後に記事主の返信があるか 4. スキ。
 */

const toTime = (iso) => new Date(iso).getTime()

/**
 * 追跡開始より後に付いた返信か。since が無ければ（追跡開始前の判定・テスト）すべて対象。
 */
export function isTrackedReply(reply, since) {
  if (!since) return true
  return toTime(reply?.created_at) > toTime(since)
}

/**
 * 記事主宛ての読者の返信か（判定の対象になる返信か）。
 */
export function isReplyToOwner(reply, ownerUrlname) {
  const from = reply?.user?.urlname
  return !!from && from !== ownerUrlname && reply?.to_user?.urlname === ownerUrlname
}

/**
 * その返信より後に、記事主からその読者への返信があるか。
 */
export function hasLaterOwnerReply(reply, replies, ownerUrlname) {
  const ts = toTime(reply.created_at)
  const reader = reply.user?.urlname
  return replies.some(
    (r) =>
      r.user?.urlname === ownerUrlname &&
      r.to_user?.urlname === reader &&
      toTime(r.created_at) > ts
  )
}

/**
 * 返信1件の状態。優先順位: replied > liked > unreplied（ルートコメントと同じ）
 *   - replied  … その後に記事主→その読者の返信がある、または手動で対応済みにした
 *   - liked    … 記事主のスキがある
 *   - unreplied… どちらでもない
 */
export function classifyReply(reply, replies, ownerUrlname, manualSet = new Set()) {
  if (hasLaterOwnerReply(reply, replies, ownerUrlname) || manualSet.has(reply.key)) return 'replied'
  if (reply.is_creator_liked) return 'liked'
  return 'unreplied'
}

/**
 * スレッド内の「追跡開始後に付いた、記事主宛ての読者の返信」に状態を付けて返す（非表示ユーザーは除く）。
 * 記事主の返信があるかどうかは、追跡開始前の発言も含めた会話全体で見る。
 */
export function classifyThreadReplies(thread, ownerUrlname, manualSet = new Set(), mutedSet = new Set(), since = null) {
  const replies = thread?.replies || []
  return replies
    .filter((r) => isTrackedReply(r, since) && isReplyToOwner(r, ownerUrlname) && !mutedSet.has(r.user.urlname))
    .map((r) => ({ ...r, status: classifyReply(r, replies, ownerUrlname, manualSet) }))
}

/**
 * スレッドの「対応待ち候補」の返信に、手動印と非表示を反映した状態を付けて返す。
 * - 取得直後のスレッド（replies あり）: 会話から判定する
 * - キャッシュのスレッド（pending あり）: 保存時の判定（未返信・いいね済み）に手動印を重ねる
 */
function pendingCandidates(thread, ownerUrlname, manualSet, mutedSet, since) {
  if (Array.isArray(thread?.replies)) {
    return classifyThreadReplies(thread, ownerUrlname, manualSet, mutedSet, since)
  }
  // キャッシュの対応待ちにも追跡開始時刻を当てる（開始時刻を入れる前のキャッシュに残った分を除く）
  return (thread?.pending || [])
    .filter((r) => isTrackedReply(r, since) && !mutedSet.has(r.user?.urlname))
    .map((r) => ({ ...r, status: manualSet.has(r.key) ? 'replied' : r.status }))
}

/**
 * スレッドに対応待ち（未返信・いいね済み）の返信があるか。
 */
export function threadHasPending(thread, ownerUrlname, manualSet = new Set(), since = null) {
  return pendingCandidates(thread, ownerUrlname, manualSet, new Set(), since).some((r) => r.status !== 'replied')
}

/**
 * スレッドを画面表示用の1項目にまとめる。対応待ちの返信が無ければ null。
 * 一覧ではスレッド単位で1枚のカードにし、代表として最新の対応待ちの返信を見せる。
 * 会話の全体はキャッシュに持たないので、開いたときに取得する。
 */
export function buildThreadItem(thread, ownerUrlname, manualSet = new Set(), mutedSet = new Set(), since = null) {
  const pending = pendingCandidates(thread, ownerUrlname, manualSet, mutedSet, since)
    .filter((r) => r.status !== 'replied')
  if (pending.length === 0) return null

  const latest = pending.reduce((a, b) => (toTime(b.created_at) > toTime(a.created_at) ? b : a))
  return {
    kind: 'thread',
    key: `thread:${thread.rootKey}`,
    rootKey: thread.rootKey,
    replyCount: thread.replyCount ?? 0,
    pendingKeys: pending.map((r) => r.key),
    status: pending.some((r) => r.status === 'unreplied') ? 'unreplied' : 'liked',
    user: latest.user,
    comment: latest.comment,
    created_at: latest.created_at,
  }
}

function slimUser(u) {
  if (!u) return null
  return { urlname: u.urlname, nickname: u.nickname, profile_image_url: u.profile_image_url }
}

/**
 * キャッシュ保存用にスレッドを縮める。会話（ルートや記事主の返信）は保存しない。
 * - 対応待ちの返信があるスレッド: key・返信数に加えて、対応待ちの返信だけを保存する
 *   （一覧のカードに出すため。ルートコメントの対応待ちを保存するのと同じ考え方）
 *   文面は構造化JSONではなくプレーンテキストにして容量を抑える
 * - それ以外: reply_count の差分判定に使う { rootKey, replyCount } だけ
 * 縮めたものをもう一度渡しても形は変わらない（冪等）。
 */
export function slimThreadForCache(thread, ownerUrlname, toText = (c) => c, since = null) {
  const base = { rootKey: thread.rootKey, replyCount: thread.replyCount }
  if (!Array.isArray(thread.replies)) {
    const kept = (thread.pending || []).filter((r) => isTrackedReply(r, since))
    return kept.length ? { ...base, pending: kept } : base
  }
  const pending = classifyThreadReplies(thread, ownerUrlname, new Set(), new Set(), since).filter((r) => r.status !== 'replied')
  if (pending.length === 0) return base
  return {
    ...base,
    pending: pending.map((r) => ({
      key: r.key,
      user: slimUser(r.user),
      created_at: r.created_at,
      status: r.status,
      comment: toText(r.comment),
    })),
  }
}

/**
 * スレッドの配列を、キャッシュ保存用の詰めた形にする。
 * 項目名の繰り返しをなくすため、rootKey をオブジェクトのキーにする。
 */
export function compactThreads(threads) {
  const replyCounts = {}
  const pendingReplies = {}
  for (const t of threads || []) {
    replyCounts[t.rootKey] = t.replyCount
    if (t.pending?.length) pendingReplies[t.rootKey] = t.pending
  }
  const out = { replyCounts }
  if (Object.keys(pendingReplies).length > 0) out.pendingReplies = pendingReplies
  return out
}

/**
 * 記事のスレッドを配列で返す。
 * - 取得直後の記事: threads をそのまま返す
 * - キャッシュの記事: replyCounts / pendingReplies から組み立てる
 * - どちらも無い（旧形式の記事、返信対応前のキャッシュ）: undefined
 */
export function threadsOf(article) {
  if (Array.isArray(article?.threads)) return article.threads
  if (!article?.replyCounts) return undefined
  return Object.entries(article.replyCounts).map(([rootKey, replyCount]) => {
    const pending = article.pendingReplies?.[rootKey]
    return pending ? { rootKey, replyCount, pending } : { rootKey, replyCount }
  })
}

/**
 * 返信を取らなくても「対応待ちの返信は無い」と言い切れるスレッドか。
 * ルート一覧の reply_count と latest_creator_reply（記事主の最新の返信）だけで判定する。
 * - 記事主がスレッドに一度も返信しておらず、ルートも記事主のものでない
 *   → 返信は記事主の発言にしか宛てられないので、記事主宛ての返信は存在しない
 * - 返信が1件だけで、記事主の返信がある → その1件は記事主の返信
 * 件数が変われば planThreadFetch で改めて判定される。
 */
export function canSkipReplyFetch(root, ownerUrlname) {
  const count = root?.reply_count || 0
  const ownerReplied = !!root?.latest_creator_reply
  if (!ownerReplied && root?.user?.urlname !== ownerUrlname) return true
  if (count === 1 && ownerReplied) return true
  return false
}

/**
 * ルート一覧とキャッシュ済みスレッドから、返信を取り直すルートと流用するスレッドを決める。
 * - reply_count > 0 のルートだけが対象
 * - キャッシュの replyCount と同じなら流用（ルートは今回取得した新しいものに差し替える）
 * - 返信を取らなくても対応待ちが無いと分かるスレッドは、件数だけ持って取得しない
 * - 基準化（追跡開始）の取得では、キャッシュに無いスレッドは件数だけ記録して返信を取らない
 *   （その時点までの返信はすべて「既存」で判定対象にならないため）
 * - それ以外で件数が違う、またはキャッシュに無ければ取り直す
 */
export function planThreadFetch(roots, cachedThreads = [], ownerUrlname = null, { baseline = false } = {}) {
  const cacheMap = new Map((cachedThreads || []).map((t) => [t.rootKey, t]))
  const toFetch = []
  const reused = []
  for (const root of roots || []) {
    const count = root.reply_count || 0
    if (count <= 0) continue
    const cached = cacheMap.get(root.key)
    if (cached && cached.replyCount === count) {
      reused.push(cached)
    } else if (baseline || (ownerUrlname && canSkipReplyFetch(root, ownerUrlname))) {
      reused.push({ rootKey: root.key, replyCount: count })
    } else {
      toFetch.push(root)
    }
  }
  return { toFetch, reused }
}

/**
 * キャッシュ済みの記事が「対応待ちを含む」か。更新時の取り直し判定に使う。
 * - ルートコメント: キャッシュには未返信・いいね済みだけが残っている。手動で対応済みにしたものは除く
 * - 返信: 対応待ちの返信があるスレッド
 */
export function articleHasPending(article, ownerUrlname, manualSet = new Set()) {
  const roots = (article?.comments || []).filter(
    (c) => c?.user?.urlname !== ownerUrlname && !c.is_creator_replied && !manualSet.has(c.key)
  )
  if (roots.length > 0) return true
  return (threadsOf(article) || []).some((t) => threadHasPending(t, ownerUrlname, manualSet))
}

/**
 * 前回の更新時刻より後に届いた「新しいコメント」「返信」の件数を数える。
 * since が無い（初回取得）なら null を返す。
 * - 新しいコメント: 他人のルートコメント
 * - 返信: 記事主宛ての読者の返信
 */
export function countNewSince(articles, ownerUrlname, since, mutedSet = new Set()) {
  if (!since) return null
  const sinceTs = toTime(since)
  if (Number.isNaN(sinceTs)) return null
  const isNew = (c) => toTime(c.created_at) > sinceTs
  const isOther = (c) => {
    const u = c?.user?.urlname
    return !!u && u !== ownerUrlname && !mutedSet.has(u)
  }
  let newComments = 0
  let newReplies = 0
  for (const a of articles || []) {
    newComments += (a.comments || []).filter((c) => isOther(c) && isNew(c)).length
    for (const t of threadsOf(a) || []) {
      newReplies += (t.replies || []).filter(
        (r) => isOther(r) && isReplyToOwner(r, ownerUrlname) && isNew(r)
      ).length
    }
  }
  return { newComments, newReplies }
}

/**
 * 更新時に、その記事のコメントを取り直すか。
 * - キャッシュに無い、または commentCount が変わった記事
 * - 新形式の記事で、キャッシュに返信数の記録が無い（返信対応前のキャッシュからの移行）
 * - 新形式の記事で、対応待ち（未返信・いいね済み）を含む … refetchPending のときだけ（更新ボタン）
 *   note で返信すると commentCount が増えるので、返信済みへの変化は1つ目の条件で拾える。
 *   これで拾うのは主に note 側でスキだけした変化（未返信→いいね済み）。起動を遅くしないよう、明示的な更新に限る
 * 旧形式の記事の取得条件は変えない（commentCount の変化だけ）。
 */
export function shouldRefetchArticle(article, cached, ownerUrlname, { legacy = false, manualSet = new Set(), refetchPending = true } = {}) {
  if (!cached) return true
  if (cached.commentCount !== article.commentCount) return true
  if (legacy) return false
  if (threadsOf(cached) === undefined) return true
  if (!refetchPending) return false
  return articleHasPending(cached, ownerUrlname, manualSet)
}
