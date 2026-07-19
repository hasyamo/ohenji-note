import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getSeasonForMonth,
  getSeasonForDate,
  resolveOutfitSeason,
  fetchOutfitUnlocks,
} from '../src/lib/seasonal-outfit.js'

const SUMMER_UNLOCKS = { summer: ['tsukiko', 'rinka'] }

// 褒め演出のちび絵を差し替えるかどうかの判定
function resolve(overrides = {}) {
  return resolveOutfitSeason({
    character: { id: 'tsukiko', fileName: 'chibi-mon.png' },
    dateStr: '2026-07-20',
    unlocks: SUMMER_UNLOCKS,
    enabled: true,
    ...overrides,
  })
}

describe('getSeasonForMonth', () => {
  it('月から季節を返す', () => {
    expect(getSeasonForMonth(4)).toBe('spring')
    expect(getSeasonForMonth(7)).toBe('summer')
    expect(getSeasonForMonth(10)).toBe('autumn')
  })

  it('冬は年をまたぐ（12月と1月が同じ季節）', () => {
    expect(getSeasonForMonth(12)).toBe('winter')
    expect(getSeasonForMonth(1)).toBe('winter')
    expect(getSeasonForMonth(2)).toBe('winter')
  })

  it('範囲外の月は null', () => {
    expect(getSeasonForMonth(13)).toBe(null)
    expect(getSeasonForMonth(0)).toBe(null)
  })
})

describe('getSeasonForDate', () => {
  it('YYYY-MM-DD から季節を返す', () => {
    expect(getSeasonForDate('2026-07-20')).toBe('summer')
    expect(getSeasonForDate('2026-01-05')).toBe('winter')
  })
})

describe('resolveOutfitSeason', () => {
  it('ON・夏・受け取り済みなら夏衣装になる', () => {
    expect(resolve()).toBe('summer')
  })

  it('OFFなら通常衣装に戻る', () => {
    expect(resolve({ enabled: false })).toBe(null)
  })

  it('季節が合わなければ通常衣装（冬に夏衣装しか持っていない）', () => {
    expect(resolve({ dateStr: '2026-01-15' })).toBe(null)
  })

  it('受け取っていないキャラは通常衣装', () => {
    expect(resolve({ character: { id: 'hiyori' } })).toBe(null)
  })

  it('解放状態が空でも落ちない', () => {
    expect(resolve({ unlocks: {} })).toBe(null)
    expect(resolve({ unlocks: null })).toBe(null)
  })

  it('コラボキャラは影響を受けない', () => {
    const collab = { fileName: 'x.png', name: 'コラボ子', isCollab: true }
    expect(resolve({ character: collab })).toBe(null)
  })

  it('鈴は夏衣装の画像が無いので、受け取り済みでも通常衣装', () => {
    expect(
      resolve({
        character: { id: 'rinka-suzu', fileName: 'chibi-thu-suzu.png' },
        unlocks: { summer: ['rinka-suzu', 'rinka'] },
      })
    ).toBe(null)
  })

  it('画像未制作の季節（秋）は受け取り済みでも通常衣装', () => {
    expect(
      resolve({ dateStr: '2026-10-01', unlocks: { autumn: ['tsukiko'] } })
    ).toBe(null)
  })
})

describe('fetchOutfitUnlocks', () => {
  let storage
  let saved

  beforeEach(() => {
    saved = null
    storage = {
      getOutfitUnlocks: vi.fn(() => null),
      setOutfitUnlocks: vi.fn((noteId, unlocks) => {
        saved = { noteId, unlocks }
      }),
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('取得に成功したらキャッシュに保存する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          outfits: [
            { characterId: 'tsukiko', season: 'summer', unlockedAt: '2026-07-01' },
            { characterId: 'rinka', season: 'summer', unlockedAt: '2026-07-02' },
          ],
        }),
      }))
    )

    const result = await fetchOutfitUnlocks('hasyamo', storage)
    expect(result.source).toBe('network')
    expect(result.unlocks).toEqual({ summer: ['tsukiko', 'rinka'] })
    expect(saved).toEqual({ noteId: 'hasyamo', unlocks: { summer: ['tsukiko', 'rinka'] } })
  })

  it('通信失敗なら前回のキャッシュを使う（オフライン）', async () => {
    storage.getOutfitUnlocks = vi.fn(() => ({ summer: ['tsukiko'] }))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const result = await fetchOutfitUnlocks('hasyamo', storage)
    expect(result.source).toBe('cache')
    expect(result.unlocks).toEqual({ summer: ['tsukiko'] })
  })

  it('通信失敗でキャッシュも無ければ通常衣装（空）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    const result = await fetchOutfitUnlocks('hasyamo', storage)
    expect(result.source).toBe('none')
    expect(result.unlocks).toEqual({})
  })

  it('HTTPエラーもキャッシュにフォールバックする', async () => {
    storage.getOutfitUnlocks = vi.fn(() => ({ summer: ['rinka'] }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))

    const result = await fetchOutfitUnlocks('hasyamo', storage)
    expect(result.source).toBe('cache')
    expect(result.unlocks).toEqual({ summer: ['rinka'] })
  })

  it('noteId が無ければ通信しない', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchOutfitUnlocks('', storage)
    expect(result.source).toBe('none')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
