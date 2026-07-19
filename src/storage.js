import { migrateManualReplied, addManualRepliedEntry } from './lib/manual-replied.js'
import { classifyStorageError, prepareCacheForSave, CURRENT_CACHE_SCHEMA_VERSION } from './lib/cache-storage.js'

const URLNAME_KEY = 'ncm_urlname'
const MANUAL_REPLIED_KEY = 'ncm_manual_replied'
const CACHE_KEY = 'ncm_cache'
const RANGE_KEY = 'ncm_range_days'
const DEBUG_EVENTS_KEY = 'ncm_debug_events'
const DEBUG_EVENTS_MAX = 50

export function getUrlname() {
  return localStorage.getItem(URLNAME_KEY) || ''
}

export function setUrlname(urlname) {
  localStorage.setItem(URLNAME_KEY, urlname)
}

// 手動返信印リスト（旧形式の文字列配列／新形式のエントリ配列／混在 を吸収）
function readRawManualReplied() {
  try {
    const raw = localStorage.getItem(MANUAL_REPLIED_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 新形式のエントリ配列を取得する。
 * 旧形式（文字列）混在ならその場で migration して返す（保存はしない）。
 */
export function getManualRepliedEntries({ appVersion = null, buildHash = null, now } = {}) {
  return migrateManualReplied(readRawManualReplied(), { now, appVersion, buildHash })
}

/**
 * 既存互換: コメントキーの配列を返す。
 * 新形式エントリでも、文字列配列でも、key の配列に揃える。
 */
export function getManualReplied() {
  return getManualRepliedEntries().map((e) => e.key)
}

/**
 * 手動返信印を追加する。
 * context には source / clickSeq / eventId / appVersion / buildHash / now を渡せる。
 * 異常を検知した場合は debug-events リングバッファに記録する。
 */
export function addManualReplied(commentId, context = {}) {
  if (!commentId || typeof commentId !== 'string') return
  const current = getManualRepliedEntries(context)
  const { entries, added, debugEvent } = addManualRepliedEntry(current, commentId, context)
  if (!added) return
  try {
    localStorage.setItem(MANUAL_REPLIED_KEY, JSON.stringify(entries))
  } catch {
    // 容量超過などの保存失敗は握りつぶす（既存挙動の踏襲）
    return
  }
  if (debugEvent) appendDebugEvent(debugEvent)
}

/**
 * デバッグイベント（リングバッファ最大 DEBUG_EVENTS_MAX 件）。
 */
export function appendDebugEvent(event) {
  try {
    const raw = localStorage.getItem(DEBUG_EVENTS_KEY)
    const list = raw ? JSON.parse(raw) : []
    const arr = Array.isArray(list) ? list : []
    arr.push(event)
    const trimmed = arr.slice(-DEBUG_EVENTS_MAX)
    localStorage.setItem(DEBUG_EVENTS_KEY, JSON.stringify(trimmed))
  } catch {
    // 保存失敗は黙って捨てる
  }
}

export function getDebugEvents() {
  try {
    const raw = localStorage.getItem(DEBUG_EVENTS_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

// Range (days): 0 = all
export function getRangeDays() {
  const v = localStorage.getItem(RANGE_KEY)
  return v === null ? 0 : Number(v)
}

export function setRangeDays(days) {
  localStorage.setItem(RANGE_KEY, String(days))
}

// Ring visibility setting
const RING_VISIBLE_KEY = 'ncm_ring_visible'

export function getRingVisible() {
  return localStorage.getItem(RING_VISIBLE_KEY) !== 'false'
}

export function setRingVisible(visible) {
  localStorage.setItem(RING_VISIBLE_KEY, visible ? 'true' : 'false')
}

// Legacy (pre-2025-09-08) comments visibility setting (default true)
const LEGACY_COMMENTS_VISIBLE_KEY = 'ncm_legacy_comments_visible'

export function getLegacyCommentsVisible() {
  return localStorage.getItem(LEGACY_COMMENTS_VISIBLE_KEY) !== 'false'
}

export function setLegacyCommentsVisible(visible) {
  localStorage.setItem(LEGACY_COMMENTS_VISIBLE_KEY, visible ? 'true' : 'false')
}

// Seasonal outfit setting (default ON) — local only, never sent to D1
const SEASONAL_OUTFIT_KEY = 'ncm_seasonal_outfit'

export function getSeasonalOutfitEnabled() {
  return localStorage.getItem(SEASONAL_OUTFIT_KEY) !== 'false'
}

export function setSeasonalOutfitEnabled(enabled) {
  localStorage.setItem(SEASONAL_OUTFIT_KEY, enabled ? 'true' : 'false')
}

// Seasonal outfit unlocks cache — { noteId, updatedAt, unlocks: { season: [characterId] } }
// D1 が正で、これは通信失敗時のフォールバック用。
const OUTFIT_UNLOCKS_KEY = 'ncm_outfit_unlocks'

export function getOutfitUnlocks(noteId) {
  try {
    const raw = localStorage.getItem(OUTFIT_UNLOCKS_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw)
    if (!cache || cache.noteId !== noteId) return null
    return cache.unlocks || null
  } catch {
    return null
  }
}

export function setOutfitUnlocks(noteId, unlocks) {
  try {
    localStorage.setItem(
      OUTFIT_UNLOCKS_KEY,
      JSON.stringify({ noteId, updatedAt: new Date().toISOString(), unlocks })
    )
  } catch {
    // localStorage full — 次回の通信で復帰できるので握りつぶす
  }
}

// View mode: 'articles' (group by article) or 'comments' (flat by comment date)
const VIEW_MODE_KEY = 'ncm_view_mode'

export function getViewMode() {
  const v = localStorage.getItem(VIEW_MODE_KEY)
  return v === 'comments' ? 'comments' : 'articles'
}

export function setViewMode(mode) {
  localStorage.setItem(VIEW_MODE_KEY, mode === 'comments' ? 'comments' : 'articles')
}

// Muted users — stored as [{urlname, nickname}]
const MUTED_KEY = 'ncm_muted_users'

export function getMutedUsers() {
  const raw = localStorage.getItem(MUTED_KEY)
  return raw ? JSON.parse(raw) : []
}

export function addMutedUser(urlname, nickname) {
  const list = getMutedUsers()
  if (!list.some((u) => u.urlname === urlname)) {
    list.push({ urlname, nickname: nickname || urlname })
    localStorage.setItem(MUTED_KEY, JSON.stringify(list))
  }
}

export function removeMutedUser(urlname) {
  const list = getMutedUsers().filter((u) => u.urlname !== urlname)
  localStorage.setItem(MUTED_KEY, JSON.stringify(list))
}

// Cache
export function getCache(urlname) {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw)
    if (cache.urlname !== urlname) return null
    return cache.articles || null
  } catch {
    return null
  }
}

export function saveCache(urlname, articles) {
  const cache = {
    urlname,
    updatedAt: new Date().toISOString(),
    articles,
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage full — ignore
  }
}

/**
 * 「raw な前回キャッシュ」をそのまま返す。
 * commitCacheDecision に渡すための入口で、urlname の判定もここで行う。
 */
export function readPreviousCacheRaw(urlname) {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw)
    if (!cache || cache.urlname !== urlname) return null
    if (!Array.isArray(cache.articles)) return null
    return cache
  } catch {
    return null
  }
}

/**
 * commitCacheDecision の出力を localStorage に書き込む。
 * 保存失敗時は **握りつぶさず**、結果オブジェクトとして返す。
 *
 * 戻り値:
 *   { ok: true,  storageStatus: 'saved',  sizeBytes }                                — 保存成功
 *   { ok: false, storageStatus: 'failed', reason, errorName, message, sizeBytes }     — 保存失敗
 *   { ok: false, storageStatus: 'skipped' }                                            — null 入力
 */
export function saveCacheWithMeta(nextCache) {
  if (!nextCache) return { ok: false, storageStatus: 'skipped' }
  const { cache, json, sizeBytes } = prepareCacheForSave(nextCache)
  try {
    localStorage.setItem(CACHE_KEY, json)
    return { ok: true, storageStatus: 'saved', sizeBytes, cache }
  } catch (error) {
    return {
      ok: false,
      storageStatus: 'failed',
      reason: classifyStorageError(error),
      errorName: error?.name || null,
      message: error?.message || null,
      sizeBytes,
    }
  }
}

/**
 * 現在のキャッシュ全体の保存ステータスを返す。
 * - cache.meta.storageStatus を読む
 * - cache 自体が無ければ 'unknown'
 */
export function getCacheStorageStatus(urlname) {
  const cache = readPreviousCacheRaw(urlname)
  return cache?.meta?.storageStatus || 'unknown'
}

/**
 * キャッシュから特定のコメントキーを削除する。
 * 「返信した」押下時、対応対象キャッシュから1件取り除くのに使う。
 * 戻り値は saveCacheWithMeta と同じ結果オブジェクト。
 */
export function removeCommentFromCache(urlname, commentKey) {
  if (!commentKey) return { ok: false, storageStatus: 'skipped' }
  const cache = readPreviousCacheRaw(urlname)
  if (!cache) return { ok: false, storageStatus: 'skipped' }
  const nextArticles = (cache.articles || [])
    .map((a) => ({
      ...a,
      comments: (a.comments || []).filter((c) => c.key !== commentKey),
    }))
    .filter((a) => (a.comments || []).length > 0)
  const nextCache = {
    ...cache,
    updatedAt: new Date().toISOString(),
    articles: nextArticles,
  }
  return saveCacheWithMeta(nextCache)
}
