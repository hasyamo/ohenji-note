import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isReplyToOwner,
  classifyReply,
  classifyThreadReplies,
  buildThreadItem,
  slimThreadForCache,
  planThreadFetch,
  canSkipReplyFetch,
  compactThreads,
  threadsOf,
  articleHasPending,
  shouldRefetchArticle,
  countNewSince,
} from '../src/lib/reply-thread.js'
import { processComments } from '../src/lib/process-comments.js'
import { filterActionableComments } from '../src/lib/cache-storage.js'
import { addManualRepliedEntry, buildSuspiciousManualGroups } from '../src/lib/manual-replied.js'
import { buildSupportData } from '../src/lib/support-data.js'
import { shouldShowPraise } from '../src/lib/should-show-praise.js'

const OWNER = 'hasyamo'
const u = (urlname) => ({ urlname, nickname: urlname })

// #293（n82dd20a7f8b0）の KITAさん（ktcrs1107）のスレッドと同じ構造
const kitaRoot = {
  key: 'nc6a331a6a9630',
  user: u('ktcrs1107'),
  created_at: '2026-09-26T08:38:25+09:00',
  reply_count: 4,
  is_creator_replied: true,
  is_creator_liked: true,
  latest_creator_reply: { key: 'r3' },
  comment: 'root',
}
const kitaReplies = [
  { key: 'r1', user: u(OWNER), to_user: u('ktcrs1107'), created_at: '2026-09-26T08:45:52+09:00', is_creator_liked: false, comment: 'a' },
  { key: 'r2', user: u('ktcrs1107'), to_user: u(OWNER), created_at: '2026-09-26T08:47:43+09:00', is_creator_liked: true, comment: 'b' },
  { key: 'r3', user: u(OWNER), to_user: u('ktcrs1107'), created_at: '2026-09-26T09:01:56+09:00', is_creator_liked: false, comment: 'c' },
  { key: 'r4', user: u('ktcrs1107'), to_user: u(OWNER), created_at: '2026-09-26T09:04:59+09:00', is_creator_liked: false, comment: 'd' },
]
const kitaThread = { rootKey: kitaRoot.key, replyCount: 4, root: kitaRoot, replies: kitaReplies }

// ai_crayon_04 さん: 最後の読者返信はスキ済み
const crayonThread = {
  rootKey: 'nc496b7cb28074',
  replyCount: 2,
  root: { key: 'nc496b7cb28074', user: u('ai_crayon_04'), created_at: '2026-09-26T09:39:08+09:00', reply_count: 2, is_creator_replied: true },
  replies: [
    { key: 'c1', user: u(OWNER), to_user: u('ai_crayon_04'), created_at: '2026-09-26T09:47:00+09:00', is_creator_liked: false },
    { key: 'c2', user: u('ai_crayon_04'), to_user: u(OWNER), created_at: '2026-09-26T09:50:00+09:00', is_creator_liked: true },
  ],
}

describe('返信の判定', () => {
  it('記事主宛ての読者の返信だけが対象', () => {
    expect(isReplyToOwner(kitaReplies[1], OWNER)).toBe(true)
    expect(isReplyToOwner(kitaReplies[0], OWNER)).toBe(false) // 記事主本人
    expect(isReplyToOwner({ user: u('x'), to_user: u('y') }, OWNER)).toBe(false) // 読者同士
  })

  it('KITAさんの 09:04 の返信は未返信、08:47 は返信済み', () => {
    const statuses = classifyThreadReplies(kitaThread, OWNER)
    expect(statuses.map((r) => [r.key, r.status])).toEqual([
      ['r2', 'replied'],
      ['r4', 'unreplied'],
    ])
  })

  it('スキ済みで後に記事主の返信が無ければ いいね済み', () => {
    expect(classifyThreadReplies(crayonThread, OWNER)[0].status).toBe('liked')
  })

  it('別の読者への記事主の返信では返信済みにならない', () => {
    const replies = [
      { key: 'x1', user: u('alice'), to_user: u(OWNER), created_at: '2026-01-01T10:00:00Z' },
      { key: 'x2', user: u(OWNER), to_user: u('bob'), created_at: '2026-01-01T11:00:00Z' },
    ]
    expect(classifyReply(replies[0], replies, OWNER)).toBe('unreplied')
  })

  it('手動の対応済み印があれば返信済み', () => {
    expect(classifyReply(kitaReplies[3], kitaReplies, OWNER, new Set(['r4']))).toBe('replied')
  })
})

describe('buildThreadItem', () => {
  it('対応待ちがあればスレッド1件の項目になる', () => {
    const item = buildThreadItem(kitaThread, OWNER)
    expect(item).toMatchObject({ kind: 'thread', rootKey: kitaRoot.key, status: 'unreplied', pendingKeys: ['r4'], replyCount: 4 })
    expect(item.created_at).toBe(kitaReplies[3].created_at)
  })

  it('対応待ちが無ければ null', () => {
    expect(buildThreadItem(kitaThread, OWNER, new Set(['r4']))).toBeNull()
  })

  it('非表示ユーザーの返信は対象外', () => {
    expect(buildThreadItem(kitaThread, OWNER, new Set(), new Set(['ktcrs1107']))).toBeNull()
  })
})

describe('processComments（ルートと返信を同じ一覧に）', () => {
  const article = {
    key: 'n82dd20a7f8b0',
    title: '#293',
    publishedAt: '2026-09-26T08:00:00+09:00',
    comments: [{ key: 'root-new', user: u('someone'), is_creator_replied: false, is_creator_liked: false }],
    threads: [kitaThread, crayonThread],
  }

  it('返信スレッドがルートコメントと同じ配列に並び、未返信件数に数えられる', () => {
    const [res] = processComments([article], OWNER)
    expect(res.comments.map((c) => c.kind || 'root')).toEqual(['root', 'thread', 'thread'])
    expect(res.unrepliedCount).toBe(3)
    // 並び順は 未返信 → いいね済み
    expect(res.comments.map((c) => c.status)).toEqual(['unreplied', 'unreplied', 'liked'])
  })

  it('手動印と非表示が返信にも効き、全部済めば褒め演出の条件を満たす', () => {
    const res = processComments([article], OWNER, ['root-new', 'r4'], ['ai_crayon_04'])
    expect(res[0].unrepliedCount).toBe(0)
    expect(shouldShowPraise(res)).toBe(true)
  })

  it('threads を持たない既存キャッシュの記事もそのまま動く', () => {
    const { threads, ...legacyShape } = article
    const [res] = processComments([legacyShape], OWNER)
    expect(res.comments).toHaveLength(1)
  })
})

describe('キャッシュ', () => {
  it('会話は保存せず、対応待ちの返信だけをプレーンテキストで残す', () => {
    const done = { ...crayonThread, replies: [...crayonThread.replies, { key: 'c3', user: u(OWNER), to_user: u('ai_crayon_04'), created_at: '2026-09-26T10:00:00+09:00' }], replyCount: 3 }
    const richKita = { ...kitaThread, replies: kitaReplies.map((r) => ({ ...r, comment: { type: 'root', children: [{ type: 'element', children: [{ type: 'text', value: `text-${r.key}` }] }] } })) }
    const [a] = filterActionableComments([{ key: 'a', comments: [], threads: [richKita, done] }], OWNER)
    expect('threads' in a).toBe(false)
    expect(a.replyCounts).toEqual({ [kitaRoot.key]: 4, [done.rootKey]: 3 })
    expect(a.pendingReplies).toEqual({
      [kitaRoot.key]: [{ key: 'r4', user: { urlname: 'ktcrs1107', nickname: 'ktcrs1107', profile_image_url: undefined }, created_at: kitaReplies[3].created_at, status: 'unreplied', comment: 'text-r4' }],
    })
    // 読むときは元のスレッドの形に戻る
    expect(threadsOf(a).map((t) => [t.rootKey, t.replyCount, !!t.pending])).toEqual([[kitaRoot.key, 4, true], [done.rootKey, 3, false]])
  })

  it('キャッシュのスレッドからも一覧の項目を作れ、手動印と非表示が効く', () => {
    const cached = slimThreadForCache(kitaThread, OWNER)
    expect(buildThreadItem(cached, OWNER)).toMatchObject({ status: 'unreplied', pendingKeys: ['r4'], comment: 'd' })
    expect(buildThreadItem(cached, OWNER, new Set(['r4']))).toBeNull()
    expect(buildThreadItem(cached, OWNER, new Set(), new Set(['ktcrs1107']))).toBeNull()
    const cachedArticle = { comments: [], ...compactThreads([cached]) }
    expect(articleHasPending(cachedArticle, OWNER)).toBe(true)
    expect(articleHasPending(cachedArticle, OWNER, new Set(['r4']))).toBe(false)
    expect(processComments([{ ...cachedArticle, key: 'a', publishedAt: '2026-09-26T00:00:00Z' }], OWNER)[0].comments[0].kind).toBe('thread')
  })

  it('縮めたスレッドをもう一度縮めても変わらない', () => {
    const once = slimThreadForCache(kitaThread, OWNER)
    expect(slimThreadForCache(once, OWNER)).toEqual(once)
  })

  it('threads の無い記事（旧形式・移行前）はそのまま', () => {
    const [a] = filterActionableComments([{ key: 'a', comments: [] }], OWNER)
    expect('threads' in a).toBe(false)
    expect('replyCounts' in a).toBe(false)
  })
})

describe('planThreadFetch', () => {
  it('reply_count が変わったスレッドと新しいスレッドだけ取り直す', () => {
    const roots = [
      { key: 'A', reply_count: 4 },
      { key: 'B', reply_count: 3 },
      { key: 'C', reply_count: 1 },
      { key: 'D', reply_count: 0 },
    ]
    const cached = [{ rootKey: 'A', replyCount: 4 }, { rootKey: 'B', replyCount: 2 }]
    const { toFetch, reused } = planThreadFetch(roots, cached)
    expect(toFetch.map((r) => r.key)).toEqual(['B', 'C'])
    expect(reused.map((t) => t.rootKey)).toEqual(['A'])
  })
})

describe('追跡開始時刻（それより前の返信は未返信にしない）', () => {
  // KITA の 08:47 と 09:04 のあいだで追跡を始めた想定
  const since = '2026-09-26T09:00:00+09:00'

  it('追跡開始前の返信は判定対象にしない', () => {
    expect(classifyThreadReplies(kitaThread, OWNER, new Set(), new Set(), since).map((r) => r.key)).toEqual(['r4'])
    expect(classifyThreadReplies(kitaThread, OWNER, new Set(), new Set(), '2026-09-26T10:00:00+09:00')).toEqual([])
  })

  it('追跡開始後の返信は、開始前の記事主の返信も含めた会話で判定する', () => {
    // r2(08:47) は開始前なので対象外。r4(09:04) は開始後で、その後に記事主の返信が無いので未返信
    expect(buildThreadItem(kitaThread, OWNER, new Set(), new Set(), since)).toMatchObject({ pendingKeys: ['r4'], status: 'unreplied' })
  })

  it('キャッシュにも追跡開始前の返信は残さない', () => {
    const [a] = filterActionableComments([{ key: 'a', comments: [], threads: [crayonThread] }], OWNER, { replyTrackingSince: '2026-09-26T10:00:00+09:00' })
    expect(a.pendingReplies).toBeUndefined()
    expect(a.replyCounts).toEqual({ [crayonThread.rootKey]: 2 })
  })

  it('追跡開始前のキャッシュに残った対応待ちも数えない', () => {
    const cached = slimThreadForCache(kitaThread, OWNER) // 追跡開始時刻なしで保存された r4(09:04)
    expect(buildThreadItem(cached, OWNER, new Set(), new Set(), '2026-09-26T10:00:00+09:00')).toBeNull()
    expect(slimThreadForCache(cached, OWNER, (c) => c, '2026-09-26T10:00:00+09:00')).toEqual({ rootKey: kitaRoot.key, replyCount: 4 })
    // 追跡開始後の返信なら残る
    expect(buildThreadItem(cached, OWNER, new Set(), new Set(), since)).toMatchObject({ pendingKeys: ['r4'] })
  })

  it('基準化の取得では返信を取らず、件数だけ記録する', () => {
    const roots = [kitaRoot, { ...crayonThread.root, latest_creator_reply: { key: 'c1' } }]
    const plan = planThreadFetch(roots, [], OWNER, { baseline: true })
    expect(plan.toFetch).toEqual([])
    expect(plan.reused).toEqual([{ rootKey: kitaRoot.key, replyCount: 4 }, { rootKey: crayonThread.rootKey, replyCount: 2 }])
    // 次の更新で件数が増えたスレッドだけ取りに行く
    const next = planThreadFetch([{ ...kitaRoot, reply_count: 5 }, roots[1]], plan.reused, OWNER)
    expect(next.toFetch.map((r) => r.key)).toEqual([kitaRoot.key])
  })
})

describe('canSkipReplyFetch（返信を取らずに済むスレッド）', () => {
  const lcr = { key: 'x', created_at: '2026-09-26T10:00:00+09:00' }

  it('記事主が返信していない読者のスレッドは取らない', () => {
    expect(canSkipReplyFetch({ user: u('a'), reply_count: 3, latest_creator_reply: null }, OWNER)).toBe(true)
  })

  it('返信1件が記事主のものなら取らない', () => {
    expect(canSkipReplyFetch({ user: u('a'), reply_count: 1, latest_creator_reply: lcr }, OWNER)).toBe(true)
  })

  it('記事主の返信の後に続きがありうるスレッドは取る', () => {
    expect(canSkipReplyFetch({ user: u('a'), reply_count: 2, latest_creator_reply: lcr }, OWNER)).toBe(false)
  })

  it('記事主自身のルートへの返信は取る', () => {
    expect(canSkipReplyFetch({ user: u(OWNER), reply_count: 1, latest_creator_reply: null }, OWNER)).toBe(false)
  })

  it('取らないスレッドも件数は持ち、件数が変われば改めて判定する', () => {
    const roots = [{ key: 'A', user: u('a'), reply_count: 1, latest_creator_reply: lcr }]
    const first = planThreadFetch(roots, [], OWNER)
    expect(first.toFetch).toEqual([])
    expect(first.reused).toEqual([{ rootKey: 'A', replyCount: 1 }])
    // 読者が返してきて 2件になった → 取る
    const next = planThreadFetch([{ ...roots[0], reply_count: 2 }], first.reused, OWNER)
    expect(next.toFetch.map((r) => r.key)).toEqual(['A'])
  })
})

describe('shouldRefetchArticle', () => {
  const art = { key: 'a', commentCount: 5 }

  it('commentCount が変われば取り直す', () => {
    expect(shouldRefetchArticle(art, { commentCount: 4, comments: [], threads: [] }, OWNER)).toBe(true)
  })

  it('対応待ちを含む記事は commentCount が同じでも取り直す', () => {
    const cached = { commentCount: 5, comments: [{ key: 'k', user: u('x'), is_creator_liked: true }], threads: [] }
    expect(shouldRefetchArticle(art, cached, OWNER)).toBe(true)
    expect(shouldRefetchArticle(art, cached, OWNER, { manualSet: new Set(['k']) })).toBe(false)
  })

  it('対応待ちの返信を含む記事も取り直す', () => {
    expect(shouldRefetchArticle(art, { commentCount: 5, comments: [], threads: [kitaThread] }, OWNER)).toBe(true)
  })

  it('起動時（refetchPending: false）は対応待ちがあっても取り直さない', () => {
    const cached = { commentCount: 5, comments: [{ key: 'k', user: u('x'), is_creator_liked: true }], replyCounts: {} }
    expect(shouldRefetchArticle(art, cached, OWNER, { refetchPending: false })).toBe(false)
    // commentCount が変われば起動時でも取り直す（note で返信した場合）
    expect(shouldRefetchArticle({ ...art, commentCount: 6 }, cached, OWNER, { refetchPending: false })).toBe(true)
    // 返信対応前のキャッシュからの移行は起動時でも取り直す
    expect(shouldRefetchArticle(art, { commentCount: 5, comments: [] }, OWNER, { refetchPending: false })).toBe(true)
  })

  it('対応待ちが無く件数も同じなら流用する', () => {
    expect(shouldRefetchArticle(art, { commentCount: 5, comments: [], replyCounts: { x: 2 } }, OWNER)).toBe(false)
  })

  it('threads を持たない既存キャッシュ（新形式）は一度取り直して移行する', () => {
    expect(shouldRefetchArticle(art, { commentCount: 5, comments: [] }, OWNER)).toBe(true)
  })

  it('旧形式の記事は commentCount の変化だけで判定する（従来どおり）', () => {
    const cached = { commentCount: 5, comments: [{ key: 'k', user: u('x') }] }
    expect(shouldRefetchArticle(art, cached, OWNER, { legacy: true })).toBe(false)
  })
})

describe('countNewSince', () => {
  const articles = [{
    comments: [
      { key: 'n1', user: u('x'), created_at: '2026-09-26T12:00:00+09:00' },
      { key: 'o1', user: u('y'), created_at: '2026-09-25T12:00:00+09:00' },
      { key: 'm1', user: u(OWNER), created_at: '2026-09-26T12:00:00+09:00' },
    ],
    threads: [kitaThread],
  }]

  it('前回更新より後のコメントと記事主宛ての返信を数える', () => {
    expect(countNewSince(articles, OWNER, '2026-09-26T09:00:00+09:00')).toEqual({ newComments: 1, newReplies: 1 })
  })

  it('初回（前回更新なし）は null', () => {
    expect(countNewSince(articles, OWNER, null)).toBeNull()
  })
})

describe('手動の対応済み印（返信スレッド）', () => {
  it('reply-thread は1操作で複数件でも異常扱いしない', () => {
    const ctx = { eventId: 'e1', source: 'reply-thread', now: '2026-09-27T00:00:00Z' }
    let entries = addManualRepliedEntry([], 'r2', ctx).entries
    const res = addManualRepliedEntry(entries, 'r4', ctx)
    expect(res.debugEvent).toBeNull()
    expect(buildSuspiciousManualGroups(res.entries)).toEqual([])
  })
})

describe('サポートデータ', () => {
  it('スレッドは本文を含めず件数と key だけ出す', () => {
    const data = buildSupportData({ cache: { articles: [{ key: 'a', comments: [], ...compactThreads([slimThreadForCache(kitaThread, OWNER)]) }] } })
    const t = data.articles[0].threads[0]
    expect(t).toEqual({ rootKey: kitaRoot.key, replyCount: 4, pending: [{ key: 'r4', user: 'ktcrs1107', status: 'unreplied' }] })
  })
})

describe('fetchUpdatedCommentsWithMeta（返信の取得）', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reply_count が変わったルートだけ parent_key 付きで返信を取る', async () => {
    const { fetchUpdatedCommentsWithMeta } = await import('../src/api.js')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const path = decodeURIComponent(new URL(url).searchParams.get('path'))
      calls.push(path)
      if (path.includes('parent_key=nc6a331a6a9630')) {
        return { ok: true, json: async () => ({ data: kitaReplies, next_page: null }) }
      }
      return { ok: true, json: async () => ({ data: [kitaRoot, { ...crayonThread.root }], next_page: null }) }
    }))

    const articles = [{ key: 'n82dd20a7f8b0', title: '#293', commentCount: 14, publishedAt: '2026-09-26T08:00:00+09:00' }]
    // crayon は件数が同じなので流用、KITA は 3→4 に増えたので取り直す
    const cached = [{ key: 'n82dd20a7f8b0', commentCount: 13, comments: [], replyCounts: { [kitaRoot.key]: 3, [crayonThread.rootKey]: 2 } }]
    const res = await fetchUpdatedCommentsWithMeta(articles, cached, OWNER, true, null, {})

    expect(res.ok).toBe(true)
    expect(calls.filter((p) => p.includes('parent_key'))).toEqual([
      '/api/v3/notes/n82dd20a7f8b0/note_comments?per_page=100&page=1&parent_key=nc6a331a6a9630&order=oldest',
    ])
    const threads = res.result[0].threads
    expect(threads.map((t) => t.rootKey)).toEqual([kitaRoot.key, crayonThread.rootKey])
    expect(threads[0].replies).toHaveLength(4)
  })
})
