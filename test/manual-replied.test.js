import { describe, it, expect } from 'vitest'
import {
  isEntry,
  migrateManualReplied,
  addManualRepliedEntry,
  buildSuspiciousManualGroups,
  indexManualReplied,
} from '../src/lib/manual-replied.js'

describe('isEntry', () => {
  it('key を持つオブジェクトは true', () => {
    expect(isEntry({ key: 'k1' })).toBe(true)
  })
  it('文字列は false', () => {
    expect(isEntry('k1')).toBe(false)
  })
  it('null は false', () => {
    expect(isEntry(null)).toBe(false)
  })
  it('key が空文字なら false', () => {
    expect(isEntry({ key: '' })).toBe(false)
  })
  it('key が無いオブジェクトは false', () => {
    expect(isEntry({ markedAt: '...' })).toBe(false)
  })
})

describe('migrateManualReplied', () => {
  const now = '2026-06-24T10:00:00.000Z'

  it('旧形式の文字列配列を legacy-array-migration として正規化する', () => {
    const result = migrateManualReplied(['k1', 'k2'], { now, appVersion: '1.6.1', buildHash: 'abc' })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      key: 'k1',
      markedAt: null,
      source: 'legacy-array-migration',
      clickSeq: null,
      eventId: null,
      appVersion: '1.6.1',
      buildHash: 'abc',
      migratedAt: now,
    })
  })

  it('既に新形式のエントリはそのまま保持する', () => {
    const entry = {
      key: 'k1',
      markedAt: '2026-06-20T00:00:00.000Z',
      source: 'reply-button',
      clickSeq: 5,
      eventId: 'evt_x',
      appVersion: '1.6.1',
      buildHash: 'abc',
    }
    const result = migrateManualReplied([entry], { now })
    expect(result).toEqual([entry])
  })

  it('混在配列を扱える（旧→新の順なら legacy 側が優先）', () => {
    const newEntry = { key: 'k1', markedAt: 'x', source: 'reply-button' }
    const result = migrateManualReplied(['k1', newEntry], { now })
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('legacy-array-migration')
  })

  it('null/undefined/空文字列の不正値は捨てる', () => {
    const result = migrateManualReplied(['k1', '', null, undefined, 0, false], { now })
    expect(result.map(e => e.key)).toEqual(['k1'])
  })

  it('Array でない入力は空配列を返す', () => {
    expect(migrateManualReplied(null)).toEqual([])
    expect(migrateManualReplied(undefined)).toEqual([])
    expect(migrateManualReplied('string')).toEqual([])
    expect(migrateManualReplied({})).toEqual([])
  })

  it('重複した key は1つだけ残す', () => {
    const result = migrateManualReplied(['k1', 'k1', 'k1'], { now })
    expect(result).toHaveLength(1)
  })
})

describe('addManualRepliedEntry', () => {
  const baseContext = {
    now: '2026-06-24T10:00:00.000Z',
    source: 'reply-button',
    clickSeq: 1,
    eventId: 'evt_1',
    appVersion: '1.6.1',
    buildHash: 'abc',
  }

  it('新しいキーを追加する', () => {
    const { entries, added, debugEvent } = addManualRepliedEntry([], 'k1', baseContext)
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe('k1')
    expect(added.key).toBe('k1')
    expect(debugEvent).toBeNull()
  })

  it('既に同じ key があれば追加しない', () => {
    const existing = [{ key: 'k1', markedAt: 'x', source: 'reply-button' }]
    const { entries, added, debugEvent } = addManualRepliedEntry(existing, 'k1', baseContext)
    expect(entries).toBe(existing)
    expect(added).toBeNull()
    expect(debugEvent).toBeNull()
  })

  it('null/undefined/空文字列を渡しても何もしない', () => {
    for (const bad of [null, undefined, '', 0, false]) {
      const { entries, added, debugEvent } = addManualRepliedEntry([], bad, baseContext)
      expect(entries).toEqual([])
      expect(added).toBeNull()
      expect(debugEvent).toBeNull()
    }
  })

  it('同じ eventId が既に他のエントリに付いていれば異常検知 debugEvent を返す', () => {
    const existing = [{ key: 'k1', markedAt: 'x', source: 'reply-button', eventId: 'evt_1', clickSeq: 1 }]
    const { entries, added, debugEvent } = addManualRepliedEntry(existing, 'k2', baseContext)
    expect(entries).toHaveLength(2)
    expect(added.key).toBe('k2')
    expect(debugEvent).not.toBeNull()
    expect(debugEvent.type).toBe('manual_replied_multiple_in_event')
    expect(debugEvent.eventId).toBe('evt_1')
    expect(debugEvent.keys).toEqual(['k1', 'k2'])
  })

  it('eventId が null なら異常検知は走らない', () => {
    const existing = [{ key: 'k1', markedAt: 'x', source: 'reply-button', eventId: null }]
    const { debugEvent } = addManualRepliedEntry(existing, 'k2', { ...baseContext, eventId: null })
    expect(debugEvent).toBeNull()
  })

  it('既存配列を変更せず、新配列を返す（イミュータブル）', () => {
    const existing = [{ key: 'k1' }]
    const { entries } = addManualRepliedEntry(existing, 'k2', baseContext)
    expect(entries).not.toBe(existing)
    expect(existing).toHaveLength(1)
  })
})

describe('buildSuspiciousManualGroups', () => {
  it('同じ eventId に複数件あるグループを抽出する', () => {
    const entries = [
      { key: 'k1', eventId: 'evt_1', clickSeq: 1, markedAt: '2026-06-16T20:34:00.000Z' },
      { key: 'k2', eventId: 'evt_1', clickSeq: 1, markedAt: '2026-06-16T20:34:00.100Z' },
      { key: 'k3', eventId: 'evt_2', clickSeq: 2, markedAt: '2026-06-16T20:35:00.000Z' },
    ]
    const groups = buildSuspiciousManualGroups(entries)
    expect(groups).toHaveLength(1)
    expect(groups[0].eventId).toBe('evt_1')
    expect(groups[0].keys).toEqual(['k1', 'k2'])
    expect(groups[0].firstMarkedAt).toBe('2026-06-16T20:34:00.000Z')
    expect(groups[0].lastMarkedAt).toBe('2026-06-16T20:34:00.100Z')
  })

  it('eventId が null のエントリは無視する', () => {
    const entries = [
      { key: 'k1', eventId: null },
      { key: 'k2', eventId: null },
    ]
    expect(buildSuspiciousManualGroups(entries)).toEqual([])
  })

  it('1件しかない eventId は除外する', () => {
    const entries = [
      { key: 'k1', eventId: 'evt_1' },
      { key: 'k2', eventId: 'evt_2' },
    ]
    expect(buildSuspiciousManualGroups(entries)).toEqual([])
  })
})

describe('indexManualReplied', () => {
  it('全 key と legacy key を分けて返す', () => {
    const entries = [
      { key: 'k1', source: 'reply-button' },
      { key: 'k2', source: 'legacy-array-migration' },
      { key: 'k3', source: 'reply-button' },
    ]
    const { all, legacy } = indexManualReplied(entries)
    expect([...all].sort()).toEqual(['k1', 'k2', 'k3'])
    expect([...legacy]).toEqual(['k2'])
  })

  it('不正なエントリは無視する', () => {
    const entries = [
      { key: 'k1', source: 'reply-button' },
      null,
      'string',
      { source: 'reply-button' },
    ]
    const { all } = indexManualReplied(entries)
    expect([...all]).toEqual(['k1'])
  })
})
