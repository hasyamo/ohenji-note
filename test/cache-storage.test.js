import { describe, it, expect } from 'vitest'
import {
  CURRENT_CACHE_SCHEMA_VERSION,
  CACHE_MODE,
  classifyStorageError,
  approxByteLength,
  filterActionableComments,
  prepareCacheForSave,
  canReuseArticleCache,
} from '../src/lib/cache-storage.js'

describe('classifyStorageError', () => {
  it('QuotaExceededError は quota_exceeded', () => {
    const e = new Error('quota')
    e.name = 'QuotaExceededError'
    expect(classifyStorageError(e)).toBe('quota_exceeded')
  })

  it('NS_ERROR_DOM_QUOTA_REACHED も quota_exceeded（Firefox 系）', () => {
    const e = new Error('q')
    e.name = 'NS_ERROR_DOM_QUOTA_REACHED'
    expect(classifyStorageError(e)).toBe('quota_exceeded')
  })

  it('code: 22 も quota_exceeded（DOMException 互換）', () => {
    expect(classifyStorageError({ code: 22 })).toBe('quota_exceeded')
  })

  it('code: 1014 も quota_exceeded', () => {
    expect(classifyStorageError({ code: 1014 })).toBe('quota_exceeded')
  })

  it('SecurityError は security', () => {
    const e = new Error('sec')
    e.name = 'SecurityError'
    expect(classifyStorageError(e)).toBe('security')
  })

  it('未知のエラーは storage_error', () => {
    expect(classifyStorageError(new Error('x'))).toBe('storage_error')
    expect(classifyStorageError(null)).toBe('storage_error')
    expect(classifyStorageError(undefined)).toBe('storage_error')
  })
})

describe('approxByteLength', () => {
  it('ASCII は文字数とほぼ一致', () => {
    expect(approxByteLength('hello')).toBe(5)
  })

  it('日本語はバイト数が大きい', () => {
    expect(approxByteLength('あ')).toBeGreaterThan(1)
  })

  it('空文字列は 0', () => {
    expect(approxByteLength('')).toBe(0)
  })

  it('非文字列は 0', () => {
    expect(approxByteLength(null)).toBe(0)
    expect(approxByteLength(undefined)).toBe(0)
    expect(approxByteLength(123)).toBe(0)
  })
})

describe('filterActionableComments', () => {
  const c = (overrides) => ({
    key: 'k',
    user: { urlname: 'someone' },
    is_creator_replied: false,
    is_creator_liked: false,
    ...overrides,
  })

  it('is_creator_replied: true は除外', () => {
    const articles = [{ key: 'a', comments: [c({ key: 'k1', is_creator_replied: true })] }]
    const result = filterActionableComments(articles, 'me')
    expect(result[0].comments).toHaveLength(0)
  })

  it('自分のコメントは除外', () => {
    const articles = [{ key: 'a', comments: [c({ key: 'k1', user: { urlname: 'me' } })] }]
    const result = filterActionableComments(articles, 'me')
    expect(result[0].comments).toHaveLength(0)
  })

  it('未返信のコメントは残す', () => {
    const articles = [{ key: 'a', comments: [c({ key: 'k1' })] }]
    const result = filterActionableComments(articles, 'me')
    expect(result[0].comments).toHaveLength(1)
  })

  it('いいね済のコメントは残す', () => {
    const articles = [{ key: 'a', comments: [c({ key: 'k1', is_creator_liked: true })] }]
    const result = filterActionableComments(articles, 'me')
    expect(result[0].comments).toHaveLength(1)
  })

  it('複数記事を扱える', () => {
    const articles = [
      { key: 'a1', comments: [c({ key: 'k1' }), c({ key: 'k2', is_creator_replied: true })] },
      { key: 'a2', comments: [c({ key: 'k3' })] },
    ]
    const result = filterActionableComments(articles, 'me')
    expect(result[0].comments).toHaveLength(1)
    expect(result[1].comments).toHaveLength(1)
  })

  it('articles が配列でなければ空配列', () => {
    expect(filterActionableComments(null, 'me')).toEqual([])
    expect(filterActionableComments(undefined, 'me')).toEqual([])
  })

  it('元の articles をミューテートしない', () => {
    const articles = [{ key: 'a', comments: [c({ key: 'k1' }), c({ key: 'k2', is_creator_replied: true })] }]
    filterActionableComments(articles, 'me')
    expect(articles[0].comments).toHaveLength(2)
  })
})

describe('prepareCacheForSave', () => {
  it('schemaVersion / cacheMode を埋め込む', () => {
    const { cache } = prepareCacheForSave({ urlname: 'me', updatedAt: 't', articles: [] })
    expect(cache.schemaVersion).toBe(CURRENT_CACHE_SCHEMA_VERSION)
    expect(cache.cacheMode).toBe(CACHE_MODE)
    expect(cache.meta.schemaVersion).toBe(CURRENT_CACHE_SCHEMA_VERSION)
    expect(cache.meta.cacheMode).toBe(CACHE_MODE)
  })

  it('cacheSizeBytes を meta に含める', () => {
    const { cache } = prepareCacheForSave({ urlname: 'me', updatedAt: 't', articles: [] })
    expect(cache.meta.cacheSizeBytes).toBeGreaterThan(0)
  })

  it('json は size を含めた最終形を返す', () => {
    const { json } = prepareCacheForSave({ urlname: 'me', updatedAt: 't', articles: [] })
    const parsed = JSON.parse(json)
    expect(parsed.meta.cacheSizeBytes).toBeGreaterThan(0)
  })

  it('null を渡しても落ちない', () => {
    const { cache, json } = prepareCacheForSave(null)
    expect(cache).toBeNull()
    expect(json).toBeNull()
  })
})

describe('canReuseArticleCache', () => {
  const cache = (overrides = {}) => ({
    schemaVersion: CURRENT_CACHE_SCHEMA_VERSION,
    meta: { fetchStatus: 'complete' },
    ...overrides,
  })
  const article = (commentCount) => ({ key: 'a', commentCount })

  it('全条件揃ったら true', () => {
    expect(canReuseArticleCache({
      cache: cache(), oldArticle: article(5), newArticle: article(5), storageStatus: 'saved',
    })).toBe(true)
  })

  it('storageStatus が saved でなければ false（前回保存失敗の流用禁止）', () => {
    expect(canReuseArticleCache({
      cache: cache(), oldArticle: article(5), newArticle: article(5), storageStatus: 'failed',
    })).toBe(false)
    expect(canReuseArticleCache({
      cache: cache(), oldArticle: article(5), newArticle: article(5), storageStatus: undefined,
    })).toBe(false)
  })

  it('fetchStatus が complete でなければ false', () => {
    expect(canReuseArticleCache({
      cache: cache({ meta: { fetchStatus: 'partial' } }),
      oldArticle: article(5), newArticle: article(5), storageStatus: 'saved',
    })).toBe(false)
  })

  it('schemaVersion が違えば false', () => {
    expect(canReuseArticleCache({
      cache: cache({ schemaVersion: 1 }),
      oldArticle: article(5), newArticle: article(5), storageStatus: 'saved',
    })).toBe(false)
  })

  it('commentCount が違えば false', () => {
    expect(canReuseArticleCache({
      cache: cache(), oldArticle: article(5), newArticle: article(6), storageStatus: 'saved',
    })).toBe(false)
  })

  it('引数が欠けたら false', () => {
    expect(canReuseArticleCache({ cache: null, oldArticle: article(5), newArticle: article(5), storageStatus: 'saved' })).toBe(false)
    expect(canReuseArticleCache({ cache: cache(), oldArticle: null, newArticle: article(5), storageStatus: 'saved' })).toBe(false)
    expect(canReuseArticleCache({ cache: cache(), oldArticle: article(5), newArticle: null, storageStatus: 'saved' })).toBe(false)
  })
})
