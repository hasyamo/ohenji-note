import { describe, it, expect } from 'vitest'
import { getCommentStatus, toCoarseStatus } from '../src/lib/comment-status.js'

const idx = (all = [], legacy = []) => ({ all: new Set(all), legacy: new Set(legacy) })

describe('getCommentStatus', () => {
  it('is_creator_replied=true なら replied_api', () => {
    const status = getCommentStatus({ key: 'k1', is_creator_replied: true }, idx())
    expect(status).toBe('replied_api')
  })

  it('通常の手動印が付いていれば replied_manual', () => {
    const status = getCommentStatus({ key: 'k1' }, idx(['k1'], []))
    expect(status).toBe('replied_manual')
  })

  it('legacy の手動印が付いていれば replied_manual_legacy', () => {
    const status = getCommentStatus({ key: 'k1' }, idx(['k1'], ['k1']))
    expect(status).toBe('replied_manual_legacy')
  })

  it('is_creator_liked=true なら liked', () => {
    const status = getCommentStatus({ key: 'k1', is_creator_liked: true }, idx())
    expect(status).toBe('liked')
  })

  it('どれも当たらなければ unreplied', () => {
    const status = getCommentStatus({ key: 'k1' }, idx())
    expect(status).toBe('unreplied')
  })

  it('replied_api は他の判定より優先される', () => {
    const status = getCommentStatus(
      { key: 'k1', is_creator_replied: true, is_creator_liked: true },
      idx(['k1'], ['k1'])
    )
    expect(status).toBe('replied_api')
  })

  it('replied_manual は liked より優先される', () => {
    const status = getCommentStatus(
      { key: 'k1', is_creator_liked: true },
      idx(['k1'], [])
    )
    expect(status).toBe('replied_manual')
  })

  it('replied_manual_legacy は liked より優先される', () => {
    const status = getCommentStatus(
      { key: 'k1', is_creator_liked: true },
      idx(['k1'], ['k1'])
    )
    expect(status).toBe('replied_manual_legacy')
  })

  it('index 未指定でも落ちない', () => {
    expect(() => getCommentStatus({ key: 'k1' })).not.toThrow()
  })

  it('comment が null でも落ちない', () => {
    expect(() => getCommentStatus(null, idx())).not.toThrow()
  })
})

describe('toCoarseStatus', () => {
  it('replied_api → replied', () => {
    expect(toCoarseStatus('replied_api')).toBe('replied')
  })
  it('replied_manual → replied', () => {
    expect(toCoarseStatus('replied_manual')).toBe('replied')
  })
  it('replied_manual_legacy → replied', () => {
    expect(toCoarseStatus('replied_manual_legacy')).toBe('replied')
  })
  it('liked はそのまま', () => {
    expect(toCoarseStatus('liked')).toBe('liked')
  })
  it('unreplied はそのまま', () => {
    expect(toCoarseStatus('unreplied')).toBe('unreplied')
  })
})
