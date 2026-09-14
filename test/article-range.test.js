import { describe, it, expect } from 'vitest'
import { sortByPublishAtDesc, calcCutoff, isOutsideRange } from '../src/lib/article-range.js'

const makeArticle = (overrides = {}) => ({
  key: 'a1',
  publishAt: '2026-09-01T00:00:00+09:00',
  isPinned: false,
  ...overrides,
})

describe('sortByPublishAtDesc', () => {
  it('先頭に固定された古いピン留め記事を正しい位置へ落とす', () => {
    // note API が実際に返す並び: page=1 の先頭にピン留めが固定される
    const contents = [
      makeArticle({ key: 'pinned', publishAt: '2026-05-11T23:28:45+09:00', isPinned: true }),
      makeArticle({ key: 'new1', publishAt: '2026-09-13T18:22:47+09:00' }),
      makeArticle({ key: 'new2', publishAt: '2026-09-12T23:24:36+09:00' }),
    ]

    const sorted = sortByPublishAtDesc(contents)

    expect(sorted.map((a) => a.key)).toEqual(['new1', 'new2', 'pinned'])
  })

  it('入力配列を破壊しない', () => {
    const contents = [
      makeArticle({ key: 'old', publishAt: '2026-01-01T00:00:00+09:00' }),
      makeArticle({ key: 'new', publishAt: '2026-09-01T00:00:00+09:00' }),
    ]

    sortByPublishAtDesc(contents)

    expect(contents.map((a) => a.key)).toEqual(['old', 'new'])
  })

  it('空配列・nullish を空配列として扱う', () => {
    expect(sortByPublishAtDesc([])).toEqual([])
    expect(sortByPublishAtDesc(null)).toEqual([])
    expect(sortByPublishAtDesc(undefined)).toEqual([])
  })
})

describe('calcCutoff', () => {
  const now = new Date('2026-09-14T00:00:00Z').getTime()

  it('rangeDays 分だけ遡ったタイムスタンプを返す', () => {
    expect(calcCutoff(30, now)).toBe(now - 30 * 86400000)
  })

  it('rangeDays が 0（すべて）なら 0 を返す', () => {
    expect(calcCutoff(0, now)).toBe(0)
  })

  it('負値も期間判定なしとして扱う', () => {
    expect(calcCutoff(-1, now)).toBe(0)
  })
})

describe('isOutsideRange', () => {
  const now = new Date('2026-09-14T00:00:00Z').getTime()
  const cutoff = calcCutoff(30, now)

  it('カットオフより前なら true', () => {
    expect(isOutsideRange(makeArticle({ publishAt: '2026-05-11T23:28:45+09:00' }), cutoff)).toBe(true)
  })

  it('カットオフより後なら false', () => {
    expect(isOutsideRange(makeArticle({ publishAt: '2026-09-13T18:22:47+09:00' }), cutoff)).toBe(false)
  })

  it('cutoff が 0（すべて）なら常に false', () => {
    expect(isOutsideRange(makeArticle({ publishAt: '2020-01-01T00:00:00+09:00' }), 0)).toBe(false)
  })
})
