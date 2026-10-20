import { migrateManualReplied, addManualRepliedEntry } from './lib/manual-replied.js'
import { classifyStorageError, prepareCacheForSave, CURRENT_CACHE_SCHEMA_VERSION } from './lib/cache-storage.js'

const URLNAME_KEY = 'ncm_urlname'
const MANUAL_REPLIED_KEY = 'ncm_manual_replied'
const CACHE_KEY = 'ncm_cache'
const RANGE_KEY = 'ncm_range_days'
const DEBUG_EVENTS_KEY = 'ncm_debug_events'
const DEBUG_EVENTS_MAX = 50

// note ID ごとに分けて持つ設定（値は文字列のまま移す）
const PER_ACCOUNT_KEYS = [
  RANGE_KEY,
  'ncm_include_pinned_outside_range',
  'ncm_ring_visible',
  'ncm_legacy_comments_visible',
  'ncm_muted_users',
]

// いま表示している note ID。保存できる ID（最大 MAX_ACCOUNTS 個）のうちの1つ
export function getUrlname() {
  return localStorage.getItem(URLNAME_KEY) || ''
}

export function setUrlname(urlname) {
  localStorage.setItem(URLNAME_KEY, urlname)
}

// 保存した note ID の一覧（本垢・サブ垢の2つまで）。並びは設定画面の入力欄の順
const SAVED_URLNAMES_KEY = 'ncm_urlnames'
export const MAX_ACCOUNTS = 2

export function getSavedUrlnames() {
  try {
    const raw = localStorage.getItem(SAVED_URLNAMES_KEY)
    const list = raw ? JSON.parse(raw) : null
    if (Array.isArray(list)) return list.filter((u) => typeof u === 'string' && u).slice(0, MAX_ACCOUNTS)
  } catch {
    // 壊れていたら、いまの ID だけとみなす
  }
  const current = getUrlname()
  return current ? [current] : []
}

export function setSavedUrlnames(list) {
  const unique = [...new Set((list || []).filter((u) => typeof u === 'string' && u))].slice(0, MAX_ACCOUNTS)
  localStorage.setItem(SAVED_URLNAMES_KEY, JSON.stringify(unique))
  return unique
}

// 切り替えボタンに出すアイコン・名前: { [urlname]: { nickname, avatarUrl } }
const ACCOUNT_PROFILES_KEY = 'ncm_account_profiles'

export function getAccountProfiles() {
  try {
    const raw = localStorage.getItem(ACCOUNT_PROFILES_KEY)
    const map = raw ? JSON.parse(raw) : {}
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

export function setAccountProfile(urlname, profile) {
  const map = getAccountProfiles()
  map[urlname] = { nickname: profile?.nickname || '', avatarUrl: profile?.avatarUrl || '' }
  try {
    localStorage.setItem(ACCOUNT_PROFILES_KEY, JSON.stringify(map))
  } catch {
    // 保存できなくても、次の起動で取り直すだけ
  }
}

// note ID ごとに分けて持つ値のキー
function keyFor(baseKey, urlname) {
  return `${baseKey}:${urlname}`
}

/**
 * 保存した ID から外したときに、その ID のデータを消す。
 * 容量を食うキャッシュと、表示用のプロフィールだけ消す（設定・非表示ユーザーは、
 * 同じ ID を入れ直したときに戻るよう残す）。
 */
export function removeAccountData(urlname) {
  if (!urlname) return
  localStorage.removeItem(keyFor(CACHE_KEY, urlname))
  const map = getAccountProfiles()
  if (map[urlname]) {
    delete map[urlname]
    try { localStorage.setItem(ACCOUNT_PROFILES_KEY, JSON.stringify(map)) } catch {}
  }
}

/**
 * note ID 1つの時代（共通のキー）から、ID ごとのキーへ移す。起動時に1回だけ動く。
 * 移す先は、いま保存されている note ID。前の版に戻したときのために、共通のキーは
 * 消さずに残す（キャッシュだけは容量を食うので移したら消す）。
 */
const MULTI_ACCOUNT_MIGRATED_KEY = 'ncm_multi_account_migrated'

export function migrateToMultiAccount() {
  if (localStorage.getItem(MULTI_ACCOUNT_MIGRATED_KEY)) return
  const owner = getUrlname()
  if (owner) {
    if (localStorage.getItem(SAVED_URLNAMES_KEY) === null) setSavedUrlnames([owner])
    for (const baseKey of PER_ACCOUNT_KEYS) {
      const value = localStorage.getItem(baseKey)
      if (value !== null && localStorage.getItem(keyFor(baseKey, owner)) === null) {
        localStorage.setItem(keyFor(baseKey, owner), value)
      }
    }
    migrateOwnedJson(OUTFIT_UNLOCKS_KEY, owner, (v) => v.noteId, false)
    migrateOwnedJson(CACHE_KEY, owner, (v) => v.urlname, true)
  }
  localStorage.setItem(MULTI_ACCOUNT_MIGRATED_KEY, new Date().toISOString())
}

// 中に持ち主の ID を持つ JSON（キャッシュ・衣装の解放状態）を、持ち主の ID のキーへ移す
function migrateOwnedJson(baseKey, owner, ownerOf, removeLegacy) {
  const raw = localStorage.getItem(baseKey)
  if (!raw) return
  let belongs = false
  try { belongs = ownerOf(JSON.parse(raw) || {}) === owner } catch {}
  const target = keyFor(baseKey, owner)
  if (belongs && localStorage.getItem(target) === null) {
    try {
      localStorage.setItem(target, raw)
    } catch {
      // 容量が足りず2つ分置けないときは、先に古い方を消してから置く（中身は手元にある）
      localStorage.removeItem(baseKey)
      try { localStorage.setItem(target, raw) } catch {}
    }
  }
  if (removeLegacy) localStorage.removeItem(baseKey)
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
 * 手動の対応済み印をまとめて追加する（返信スレッドの「対応済みにする」用）。
 * 1回の操作で複数件を記録するのが正常な動きなので、source を 'reply-thread' にして
 * 「1クリックで複数件」の異常検知から外す。
 */
export function addManualRepliedMany(keys, context = {}) {
  const valid = (keys || []).filter((k) => typeof k === 'string' && k)
  if (valid.length === 0) return
  const ctx = { ...context, source: 'reply-thread' }
  let entries = getManualRepliedEntries(ctx)
  let changed = false
  for (const key of valid) {
    const res = addManualRepliedEntry(entries, key, ctx)
    if (res.added) {
      entries = res.entries
      changed = true
    }
  }
  if (!changed) return
  try {
    localStorage.setItem(MANUAL_REPLIED_KEY, JSON.stringify(entries))
  } catch {
    // 容量超過などの保存失敗は握りつぶす（addManualReplied と同じ）
  }
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

// Range (days): 0 = all（note ID ごと）
export function getRangeDays(urlname = getUrlname()) {
  const v = localStorage.getItem(keyFor(RANGE_KEY, urlname))
  return v === null ? 0 : Number(v)
}

export function setRangeDays(days, urlname = getUrlname()) {
  localStorage.setItem(keyFor(RANGE_KEY, urlname), String(days))
}

// Include pinned articles that fall outside the fetch range (default true).
// 固定記事は古くても露出し続けるため新しいコメントが付きやすい。
// 「返信し忘れを拾う」というアプリの目的上、取りこぼさない側をデフォルトにする。
const INCLUDE_PINNED_OUTSIDE_RANGE_KEY = 'ncm_include_pinned_outside_range'

export function getIncludePinnedOutsideRange(urlname = getUrlname()) {
  return localStorage.getItem(keyFor(INCLUDE_PINNED_OUTSIDE_RANGE_KEY, urlname)) !== 'false'
}

export function setIncludePinnedOutsideRange(include, urlname = getUrlname()) {
  localStorage.setItem(keyFor(INCLUDE_PINNED_OUTSIDE_RANGE_KEY, urlname), include ? 'true' : 'false')
}

// Ring visibility setting
const RING_VISIBLE_KEY = 'ncm_ring_visible'

export function getRingVisible(urlname = getUrlname()) {
  return localStorage.getItem(keyFor(RING_VISIBLE_KEY, urlname)) !== 'false'
}

export function setRingVisible(visible, urlname = getUrlname()) {
  localStorage.setItem(keyFor(RING_VISIBLE_KEY, urlname), visible ? 'true' : 'false')
}

// Legacy (pre-2025-09-08) comments visibility setting (default true)
const LEGACY_COMMENTS_VISIBLE_KEY = 'ncm_legacy_comments_visible'

export function getLegacyCommentsVisible(urlname = getUrlname()) {
  return localStorage.getItem(keyFor(LEGACY_COMMENTS_VISIBLE_KEY, urlname)) !== 'false'
}

export function setLegacyCommentsVisible(visible, urlname = getUrlname()) {
  localStorage.setItem(keyFor(LEGACY_COMMENTS_VISIBLE_KEY, urlname), visible ? 'true' : 'false')
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
    const raw = localStorage.getItem(keyFor(OUTFIT_UNLOCKS_KEY, noteId))
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
      keyFor(OUTFIT_UNLOCKS_KEY, noteId),
      JSON.stringify({ noteId, updatedAt: new Date().toISOString(), unlocks })
    )
  } catch {
    // localStorage full — 次回の通信で復帰できるので握りつぶす
  }
}

// 返信の追跡開始時刻（note ID ごと）: { [urlname]: ISO8601 }
// 返信スレッド対応版で初めて取得に成功した時刻。これより前の返信は未返信として数えない。
const REPLY_TRACKING_KEY = 'ncm_reply_tracking_started_at'

function readReplyTrackingMap() {
  try {
    const raw = localStorage.getItem(REPLY_TRACKING_KEY)
    const map = raw ? JSON.parse(raw) : {}
    return map && typeof map === 'object' ? map : {}
  } catch {
    return {}
  }
}

export function getReplyTrackingStartedAt(urlname) {
  return readReplyTrackingMap()[urlname] || null
}

export function setReplyTrackingStartedAt(urlname, iso) {
  const map = readReplyTrackingMap()
  map[urlname] = iso
  try {
    localStorage.setItem(REPLY_TRACKING_KEY, JSON.stringify(map))
  } catch {
    // 保存できなければ次回も基準化の取得になる（過去分を未返信にしない側に倒れる）
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

// Muted users — stored as [{urlname, nickname}]（note ID ごと。owner がその ID）
const MUTED_KEY = 'ncm_muted_users'

export function getMutedUsers(owner = getUrlname()) {
  try {
    const raw = localStorage.getItem(keyFor(MUTED_KEY, owner))
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function addMutedUser(urlname, nickname, owner = getUrlname()) {
  const list = getMutedUsers(owner)
  if (!list.some((u) => u.urlname === urlname)) {
    list.push({ urlname, nickname: nickname || urlname })
    localStorage.setItem(keyFor(MUTED_KEY, owner), JSON.stringify(list))
  }
}

export function removeMutedUser(urlname, owner = getUrlname()) {
  const list = getMutedUsers(owner).filter((u) => u.urlname !== urlname)
  localStorage.setItem(keyFor(MUTED_KEY, owner), JSON.stringify(list))
}

// Cache
export function getCache(urlname) {
  try {
    const raw = localStorage.getItem(keyFor(CACHE_KEY, urlname))
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
    localStorage.setItem(keyFor(CACHE_KEY, urlname), JSON.stringify(cache))
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
    const raw = localStorage.getItem(keyFor(CACHE_KEY, urlname))
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
  if (!nextCache || !nextCache.urlname) return { ok: false, storageStatus: 'skipped' }
  const { cache, json, sizeBytes } = prepareCacheForSave(nextCache)
  try {
    localStorage.setItem(keyFor(CACHE_KEY, cache.urlname), json)
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
 * 「対応済みにする」押下時、対応対象キャッシュから1件取り除くのに使う。
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
    // 返信スレッドを持つ記事は残す（落とすと次回、全スレッドの返信を取り直すことになる）
    .filter((a) => (a.comments || []).length > 0 || Object.keys(a.replyCounts || {}).length > 0)
  const nextCache = {
    ...cache,
    updatedAt: new Date().toISOString(),
    articles: nextArticles,
  }
  return saveCacheWithMeta(nextCache)
}
