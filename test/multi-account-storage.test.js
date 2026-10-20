// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  migrateToMultiAccount,
  getUrlname,
  setUrlname,
  getSavedUrlnames,
  setSavedUrlnames,
  removeAccountData,
  getCache,
  saveCache,
  getMutedUsers,
  addMutedUser,
  getRangeDays,
  setRangeDays,
  getRingVisible,
  getIncludePinnedOutsideRange,
  getLegacyCommentsVisible,
  getOutfitUnlocks,
  getReplyTrackingStartedAt,
  getManualReplied,
} from '../src/storage.js'

// note ID 1つの時代（v2.0.0）の保存データ
function seedLegacy() {
  localStorage.setItem('ncm_urlname', 'hasyamo')
  localStorage.setItem('ncm_cache', JSON.stringify({ urlname: 'hasyamo', updatedAt: '2026-10-20T00:00:00.000Z', articles: [{ key: 'n1', comments: [] }] }))
  localStorage.setItem('ncm_muted_users', JSON.stringify([{ urlname: 'spam', nickname: 'スパム' }]))
  localStorage.setItem('ncm_range_days', '30')
  localStorage.setItem('ncm_ring_visible', 'false')
  localStorage.setItem('ncm_include_pinned_outside_range', 'false')
  localStorage.setItem('ncm_legacy_comments_visible', 'false')
  localStorage.setItem('ncm_outfit_unlocks', JSON.stringify({ noteId: 'hasyamo', updatedAt: 'x', unlocks: { autumn: ['mio'] } }))
  localStorage.setItem('ncm_reply_tracking_started_at', JSON.stringify({ hasyamo: '2026-09-25T00:00:00.000Z' }))
  localStorage.setItem('ncm_manual_replied', JSON.stringify(['c1', 'c2']))
}

beforeEach(() => {
  localStorage.clear()
})

describe('migrateToMultiAccount', () => {
  it('いまの note ID の設定・キャッシュ・非表示ユーザーをそのまま引き継ぐ', () => {
    seedLegacy()
    migrateToMultiAccount()

    expect(getUrlname()).toBe('hasyamo')
    expect(getSavedUrlnames()).toEqual(['hasyamo'])
    expect(getCache('hasyamo')).toEqual([{ key: 'n1', comments: [] }])
    expect(getMutedUsers('hasyamo')).toEqual([{ urlname: 'spam', nickname: 'スパム' }])
    expect(getRangeDays('hasyamo')).toBe(30)
    expect(getRingVisible('hasyamo')).toBe(false)
    expect(getIncludePinnedOutsideRange('hasyamo')).toBe(false)
    expect(getLegacyCommentsVisible('hasyamo')).toBe(false)
    expect(getOutfitUnlocks('hasyamo')).toEqual({ autumn: ['mio'] })
    expect(getReplyTrackingStartedAt('hasyamo')).toBe('2026-09-25T00:00:00.000Z')
    expect(getManualReplied()).toEqual(['c1', 'c2'])
  })

  it('古いキャッシュは移したら消す（2人分で容量を食わない）', () => {
    seedLegacy()
    migrateToMultiAccount()
    expect(localStorage.getItem('ncm_cache')).toBeNull()
  })

  it('2回目以降は何もしない（移したあとの変更を古い値で上書きしない）', () => {
    seedLegacy()
    migrateToMultiAccount()
    setRangeDays(90, 'hasyamo')
    migrateToMultiAccount()
    expect(getRangeDays('hasyamo')).toBe(90)
  })

  it('note ID がまだ無い人は、何も移さない', () => {
    migrateToMultiAccount()
    expect(getSavedUrlnames()).toEqual([])
  })

  it('別の ID のキャッシュは引き継がない', () => {
    seedLegacy()
    localStorage.setItem('ncm_cache', JSON.stringify({ urlname: 'other', articles: [] }))
    migrateToMultiAccount()
    expect(getCache('hasyamo')).toBeNull()
  })
})

describe('note ID ごとに分かれる', () => {
  beforeEach(() => {
    seedLegacy()
    migrateToMultiAccount()
    setSavedUrlnames(['hasyamo', 'hasyamo_sub'])
  })

  it('キャッシュは2人分を同時に持てる', () => {
    saveCache('hasyamo_sub', [{ key: 's1', comments: [] }])
    expect(getCache('hasyamo')).toEqual([{ key: 'n1', comments: [] }])
    expect(getCache('hasyamo_sub')).toEqual([{ key: 's1', comments: [] }])
  })

  it('本垢で非表示にした人は、サブ垢では非表示にならない', () => {
    addMutedUser('troll', 'トロール', 'hasyamo')
    expect(getMutedUsers('hasyamo').map((u) => u.urlname)).toEqual(['spam', 'troll'])
    expect(getMutedUsers('hasyamo_sub')).toEqual([])
  })

  it('追加した ID の設定は初期値から始まる', () => {
    expect(getRangeDays('hasyamo_sub')).toBe(0)
    expect(getRingVisible('hasyamo_sub')).toBe(true)
  })

  it('引数を省くと、いま表示中の ID の値になる', () => {
    setUrlname('hasyamo_sub')
    setRangeDays(180)
    expect(getRangeDays()).toBe(180)
    expect(getRangeDays('hasyamo')).toBe(30)
  })

  it('保存できる ID は2つまで', () => {
    expect(setSavedUrlnames(['a', 'b', 'c'])).toEqual(['a', 'b'])
    expect(getSavedUrlnames()).toEqual(['a', 'b'])
  })

  it('外した ID のキャッシュは消え、残した ID のキャッシュは残る', () => {
    saveCache('hasyamo_sub', [{ key: 's1', comments: [] }])
    removeAccountData('hasyamo_sub')
    expect(getCache('hasyamo_sub')).toBeNull()
    expect(getCache('hasyamo')).not.toBeNull()
  })
})
