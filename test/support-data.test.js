import { describe, it, expect } from 'vitest'
import { buildSupportData } from '../src/lib/support-data.js'

describe('buildSupportData', () => {
  it('最小入力でも構造化された結果を返す', () => {
    const result = buildSupportData({})
    expect(result).toHaveProperty('app')
    expect(result).toHaveProperty('settings')
    expect(result).toHaveProperty('stats')
    expect(result).toHaveProperty('manualReplied')
    expect(result).toHaveProperty('suspiciousGroups')
    expect(result).toHaveProperty('debugEvents')
    expect(result).toHaveProperty('articles')
  })

  it('app 情報を保持する', () => {
    const result = buildSupportData({
      appVersion: '1.6.1',
      buildHash: 'abc',
      exportedAt: '2026-06-24T00:00:00.000Z',
      userAgent: 'TestAgent',
    })
    expect(result.app).toEqual({
      appVersion: '1.6.1',
      buildHash: 'abc',
      exportedAt: '2026-06-24T00:00:00.000Z',
      userAgent: 'TestAgent',
    })
  })

  it('settings を保持する', () => {
    const result = buildSupportData({
      settings: { urlname: 'me', rangeDays: 0, ringVisible: true, legacyCommentsVisible: false, viewMode: 'articles', mutedUsers: [{ urlname: 'x' }] },
    })
    expect(result.settings.urlname).toBe('me')
    expect(result.settings.rangeDays).toBe(0)
    expect(result.settings.legacyCommentsVisible).toBe(false)
    expect(result.settings.mutedUsers).toEqual([{ urlname: 'x' }])
  })

  it('manualReplied エントリをそのまま保持する', () => {
    const entries = [
      { key: 'k1', markedAt: 't1', source: 'reply-button' },
      { key: 'k2', markedAt: null, source: 'legacy-array-migration' },
    ]
    const result = buildSupportData({ manualRepliedEntries: entries })
    expect(result.manualReplied).toEqual(entries)
  })

  it('legacy エントリの件数を stats に計上する', () => {
    const entries = [
      { key: 'k1', source: 'reply-button' },
      { key: 'k2', source: 'legacy-array-migration' },
      { key: 'k3', source: 'legacy-array-migration' },
    ]
    const result = buildSupportData({ manualRepliedEntries: entries })
    expect(result.stats.manualRepliedCount).toBe(3)
    expect(result.stats.manualRepliedLegacyCount).toBe(2)
  })

  it('debugEvents をそのまま保持する', () => {
    const events = [{ type: 'manual_replied_multiple_in_event', at: 't1' }]
    const result = buildSupportData({ debugEvents: events })
    expect(result.debugEvents).toEqual(events)
  })

  it('suspiciousGroups を集計する', () => {
    const entries = [
      { key: 'k1', eventId: 'evt_1', clickSeq: 1, markedAt: 't1' },
      { key: 'k2', eventId: 'evt_1', clickSeq: 1, markedAt: 't2' },
      { key: 'k3', eventId: 'evt_2', clickSeq: 2, markedAt: 't3' },
    ]
    const result = buildSupportData({ manualRepliedEntries: entries })
    expect(result.suspiciousGroups).toHaveLength(1)
    expect(result.suspiciousGroups[0].eventId).toBe('evt_1')
    expect(result.suspiciousGroups[0].keys).toEqual(['k1', 'k2'])
  })

  it('articles を要約形式（コメントの最小情報のみ）に変換する', () => {
    const cache = {
      articles: [{
        key: 'a1',
        title: 'タイトル',
        publishedAt: '2026-01-01',
        commentCount: 2,
        comments: [
          { key: 'c1', user: { urlname: 'u1' }, is_creator_replied: true, is_creator_liked: true, body: '本文1' },
          { key: 'c2', user: { urlname: 'u2' }, is_creator_replied: false, is_creator_liked: false, body: '本文2' },
        ],
      }],
    }
    const result = buildSupportData({ cache })
    expect(result.articles[0].comments[0]).toEqual({
      key: 'c1',
      user: 'u1',
      is_creator_replied: true,
      is_creator_liked: true,
      legacy: false,
    })
    expect(result.articles[0].cachedCommentCount).toBe(2)
  })

  it('コメント本文は含めない（要約のみ）', () => {
    const cache = {
      articles: [{
        key: 'a1', title: 't', publishedAt: 'p', commentCount: 1,
        comments: [{ key: 'c1', user: { urlname: 'u' }, body: '秘密の本文' }],
      }],
    }
    const result = buildSupportData({ cache })
    const flat = JSON.stringify(result)
    expect(flat).not.toContain('秘密の本文')
  })

  it('cache が null でも落ちない', () => {
    const result = buildSupportData({ cache: null })
    expect(result.articles).toEqual([])
    expect(result.stats.articleCount).toBe(0)
  })

  it('stats: manualRepliedKeyInCache は cache 内コメントとマッチする key 数', () => {
    const entries = [
      { key: 'c1', source: 'reply-button' },
      { key: 'c2', source: 'reply-button' },
      { key: 'orphan', source: 'reply-button' },
    ]
    const cache = {
      articles: [{
        key: 'a1', title: 't', publishedAt: 'p', commentCount: 2,
        comments: [
          { key: 'c1', user: { urlname: 'u' } },
          { key: 'c2', user: { urlname: 'u' } },
        ],
      }],
    }
    const result = buildSupportData({ manualRepliedEntries: entries, cache })
    expect(result.stats.manualRepliedKeyInCache).toBe(2)
  })
})
