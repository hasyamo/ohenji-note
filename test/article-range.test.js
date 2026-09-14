import { describe, it, expect } from 'vitest'
import { sortByPublishAtDesc, calcCutoff, isOutsideRange, shouldStopForRange } from '../src/lib/article-range.js'

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

describe('shouldStopForRange', () => {
  const now = new Date('2026-09-14T00:00:00Z').getTime()
  const cutoff = calcCutoff(30, now)

  const inRange = { publishAt: '2026-09-13T18:22:47+09:00' }
  const outOfRange = { publishAt: '2026-05-11T23:28:45+09:00' }

  // ジュリ提案のテスト表（設計相談 2026-09-14）
  it.each([
    ['固定記事・期間内',  { ...inRange,    isPinned: true  }, true,  false],
    ['固定記事・期間内',  { ...inRange,    isPinned: true  }, false, false],
    ['固定記事・期間外',  { ...outOfRange, isPinned: true  }, true,  false],
    ['固定記事・期間外',  { ...outOfRange, isPinned: true  }, false, true],
    ['通常記事・期間内',  { ...inRange,    isPinned: false }, true,  false],
    ['通常記事・期間内',  { ...inRange,    isPinned: false }, false, false],
    ['通常記事・期間外',  { ...outOfRange, isPinned: false }, true,  true],
    ['通常記事・期間外',  { ...outOfRange, isPinned: false }, false, true],
  ])('%s / 含める=%o → 打ち切り=%o', (_label, article, include, expected) => {
    expect(shouldStopForRange(article, cutoff, include)).toBe(expected)
  })

  it('「すべて」(cutoff=0) ならどの記事でも打ち切らない', () => {
    expect(shouldStopForRange({ ...outOfRange, isPinned: false }, 0, false)).toBe(false)
    expect(shouldStopForRange({ ...outOfRange, isPinned: true }, 0, false)).toBe(false)
  })
})

describe('回帰: 1ページ目先頭の古い固定記事で早期停止しない', () => {
  const now = new Date('2026-09-14T00:00:00Z').getTime()
  const cutoff = calcCutoff(30, now)

  // note API が実際に返す並び（まりーさんの support-info.json 再現）
  const rawPage = [
    { key: 'pinned', publishAt: '2026-05-11T23:28:45+09:00', isPinned: true },
    { key: 'new1', publishAt: '2026-09-13T18:22:47+09:00', isPinned: false },
    { key: 'new2', publishAt: '2026-09-12T23:24:36+09:00', isPinned: false },
  ]

  // api.js の走査を再現するヘルパー
  const scan = (contents, include) => {
    const picked = []
    let reachedCutoff = false
    for (const a of sortByPublishAtDesc(contents)) {
      if (shouldStopForRange(a, cutoff, include)) {
        reachedCutoff = true
        break
      }
      if (isOutsideRange(a, cutoff)) reachedCutoff = true
      picked.push(a.key)
    }
    return { picked, reachedCutoff }
  }

  it('OFF: 固定記事を除外しつつ後続の新記事を取得できる', () => {
    const { picked, reachedCutoff } = scan(rawPage, false)
    expect(picked).toEqual(['new1', 'new2'])
    expect(reachedCutoff).toBe(true)
  })

  it('ON: 固定記事＋後続の新記事の両方を取得する', () => {
    const { picked, reachedCutoff } = scan(rawPage, true)
    expect(picked).toEqual(['new1', 'new2', 'pinned'])
    // 期間外へ到達済み＝次ページを見に行かない（無限ページングの回帰テスト）
    expect(reachedCutoff).toBe(true)
  })

  it('固定記事しかない / ON: 取得する', () => {
    const { picked } = scan([rawPage[0]], true)
    expect(picked).toEqual(['pinned'])
  })

  it('固定記事しかない / OFF かつ期間外: 0件', () => {
    const { picked } = scan([rawPage[0]], false)
    expect(picked).toEqual([])
  })
})
