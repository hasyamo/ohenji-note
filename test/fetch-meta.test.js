import { describe, it, expect } from 'vitest'
import {
  emptyFetchMeta,
  isReliableFetchMeta,
  commitCacheDecision,
  appendPageLog,
  markFetchComplete,
  markFetchPartial,
  markFetchFailed,
  mergeFetchMeta,
} from '../src/lib/fetch-meta.js'

describe('emptyFetchMeta', () => {
  it('初期状態は unknown', () => {
    const meta = emptyFetchMeta()
    expect(meta.fetchStatus).toBe('unknown')
    expect(meta.pageLogs).toEqual([])
    expect(meta.errors).toEqual([])
  })
})

describe('isReliableFetchMeta', () => {
  it('fetchStatus=complete のみ true', () => {
    expect(isReliableFetchMeta({ fetchStatus: 'complete' })).toBe(true)
  })
  it('partial は false', () => {
    expect(isReliableFetchMeta({ fetchStatus: 'partial' })).toBe(false)
  })
  it('failed は false', () => {
    expect(isReliableFetchMeta({ fetchStatus: 'failed' })).toBe(false)
  })
  it('unknown は false', () => {
    expect(isReliableFetchMeta({ fetchStatus: 'unknown' })).toBe(false)
  })
  it('meta なしは false', () => {
    expect(isReliableFetchMeta(null)).toBe(false)
    expect(isReliableFetchMeta(undefined)).toBe(false)
  })
})

describe('commitCacheDecision', () => {
  const now = '2026-06-24T00:00:00.000Z'
  const urlname = 'me'

  describe('成功時（complete）', () => {
    it('既存キャッシュがあっても新キャッシュで上書きする', () => {
      const previousCache = { urlname, updatedAt: 'old', articles: [{ key: 'old' }] }
      const result = {
        ok: true,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'complete' },
        articles: [{ key: 'new' }],
      }
      const decision = commitCacheDecision({ previousCache, result, urlname, now })
      expect(decision.action).toBe('commit')
      expect(decision.nextCache.articles).toEqual([{ key: 'new' }])
      expect(decision.nextCache.meta.fetchStatus).toBe('complete')
    })

    it('既存キャッシュが無くても commit する', () => {
      const result = {
        ok: true,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'complete' },
        articles: [{ key: 'a1' }],
      }
      const decision = commitCacheDecision({ previousCache: null, result, urlname, now })
      expect(decision.action).toBe('commit')
    })
  })

  describe('部分取得時（partial）', () => {
    it('既存キャッシュがあれば keep（既存を壊さない）', () => {
      const previousCache = { urlname, updatedAt: 'old', articles: [{ key: 'old' }], meta: emptyFetchMeta() }
      const result = {
        ok: true,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'partial' },
        articles: [{ key: 'new' }],
      }
      const decision = commitCacheDecision({ previousCache, result, urlname, now })
      expect(decision.action).toBe('keep')
      expect(decision.nextCache.articles).toEqual([{ key: 'old' }])
      expect(decision.nextCache.meta.lastPartialAttempt).toBeDefined()
    })

    it('既存キャッシュが無ければ部分でも commit する（初回保存）', () => {
      const result = {
        ok: true,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'partial' },
        articles: [{ key: 'a1' }],
      }
      const decision = commitCacheDecision({ previousCache: null, result, urlname, now })
      expect(decision.action).toBe('commit')
    })
  })

  describe('失敗時（failed / !ok）', () => {
    it('既存キャッシュがあれば keep（既存を壊さない）', () => {
      const previousCache = { urlname, updatedAt: 'old', articles: [{ key: 'old' }], meta: emptyFetchMeta() }
      const result = {
        ok: false,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'failed' },
        articles: [],
      }
      const decision = commitCacheDecision({ previousCache, result, urlname, now })
      expect(decision.action).toBe('keep')
      expect(decision.nextCache.articles).toEqual([{ key: 'old' }])
      expect(decision.nextCache.meta.lastFailedAttempt).toBeDefined()
    })

    it('既存キャッシュが無ければ空メタを commit-empty', () => {
      const result = {
        ok: false,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'failed' },
        articles: [],
      }
      const decision = commitCacheDecision({ previousCache: null, result, urlname, now })
      expect(decision.action).toBe('commit-empty')
      expect(decision.nextCache.articles).toEqual([])
    })

    it('既存キャッシュの articles が空配列でも keep ではなく commit-empty にする', () => {
      // 既存が「空配列のキャッシュ」だったら hasPrevious=false 扱い
      const previousCache = { urlname, updatedAt: 'old', articles: [] }
      const result = {
        ok: false,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'failed' },
        articles: [],
      }
      const decision = commitCacheDecision({ previousCache, result, urlname, now })
      expect(decision.action).toBe('commit-empty')
    })
  })

  describe('既存キャッシュの保護（再発防止の本丸）', () => {
    it('partial かつ既存ありなら、絶対に既存配列を上書きしない', () => {
      const previousArticles = [{ key: 'safe1' }, { key: 'safe2' }]
      const previousCache = { urlname, updatedAt: 'old', articles: previousArticles, meta: emptyFetchMeta() }
      const result = {
        ok: true,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'partial' },
        articles: [],
      }
      const decision = commitCacheDecision({ previousCache, result, urlname, now })
      expect(decision.nextCache.articles).toBe(previousArticles)
    })

    it('failed かつ既存ありなら、絶対に既存配列を上書きしない', () => {
      const previousArticles = [{ key: 'safe1' }]
      const previousCache = { urlname, updatedAt: 'old', articles: previousArticles }
      const result = {
        ok: false,
        fetchMeta: { ...emptyFetchMeta(), fetchStatus: 'failed' },
        articles: [],
      }
      const decision = commitCacheDecision({ previousCache, result, urlname, now })
      expect(decision.nextCache.articles).toBe(previousArticles)
    })
  })
})

describe('appendPageLog', () => {
  it('pageLogs と pageCount を更新する', () => {
    const meta = emptyFetchMeta()
    const next = appendPageLog(meta, { pageNo: 1, articleCount: 20, status: 'ok' })
    expect(next.pageLogs).toHaveLength(1)
    expect(next.pageCount).toBe(1)
  })

  it('既存の meta をミューテートしない', () => {
    const meta = emptyFetchMeta()
    appendPageLog(meta, { pageNo: 1 })
    expect(meta.pageLogs).toHaveLength(0)
  })
})

describe('mark系の遷移', () => {
  it('markFetchComplete', () => {
    const meta = emptyFetchMeta()
    const next = markFetchComplete(meta, { articleCount: 100, commentCount: 500, finishedAt: 't' })
    expect(next.fetchStatus).toBe('complete')
    expect(next.articleCount).toBe(100)
    expect(next.commentCount).toBe(500)
    expect(next.finishedAt).toBe('t')
  })

  it('markFetchPartial: stoppedReason を保持する', () => {
    const meta = emptyFetchMeta()
    const next = markFetchPartial(meta, { articleCount: 50, commentCount: 200, stoppedReason: 'range_cutoff', finishedAt: 't' })
    expect(next.fetchStatus).toBe('partial')
    expect(next.stoppedReason).toBe('range_cutoff')
  })

  it('markFetchFailed: error を errors に追加', () => {
    const meta = emptyFetchMeta()
    const next = markFetchFailed(meta, { error: new Error('boom'), phase: 'articles' })
    expect(next.fetchStatus).toBe('failed')
    expect(next.errors).toHaveLength(1)
    expect(next.errors[0].message).toBe('boom')
    expect(next.errors[0].phase).toBe('articles')
  })
})

describe('mergeFetchMeta', () => {
  it('両方 complete なら complete', () => {
    const a = { ...emptyFetchMeta(), fetchStatus: 'complete' }
    const b = { ...emptyFetchMeta(), fetchStatus: 'complete' }
    expect(mergeFetchMeta(a, b).fetchStatus).toBe('complete')
  })

  it('一方が partial なら partial', () => {
    const a = { ...emptyFetchMeta(), fetchStatus: 'complete' }
    const b = { ...emptyFetchMeta(), fetchStatus: 'partial' }
    expect(mergeFetchMeta(a, b).fetchStatus).toBe('partial')
  })

  it('一方が failed なら failed（partial より優先）', () => {
    const a = { ...emptyFetchMeta(), fetchStatus: 'partial' }
    const b = { ...emptyFetchMeta(), fetchStatus: 'failed' }
    expect(mergeFetchMeta(a, b).fetchStatus).toBe('failed')
  })

  it('pageLogs / errors は両方を連結する', () => {
    const a = { ...emptyFetchMeta(), pageLogs: [{ pageNo: 1 }], errors: [{ message: 'e1' }] }
    const b = { ...emptyFetchMeta(), pageLogs: [{ pageNo: 2 }], errors: [{ message: 'e2' }] }
    const merged = mergeFetchMeta(a, b)
    expect(merged.pageLogs).toHaveLength(2)
    expect(merged.errors).toHaveLength(2)
  })

  it('null/undefined を渡しても落ちない', () => {
    expect(() => mergeFetchMeta(null, null)).not.toThrow()
    expect(mergeFetchMeta(null, null).fetchStatus).toBe('unknown')
  })
})
