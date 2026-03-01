const URLNAME_KEY = 'ncm_urlname'
const MANUAL_REPLIED_KEY = 'ncm_manual_replied'
const CACHE_KEY = 'ncm_cache'
const RANGE_KEY = 'ncm_range_days'

export function getUrlname() {
  return localStorage.getItem(URLNAME_KEY) || ''
}

export function setUrlname(urlname) {
  localStorage.setItem(URLNAME_KEY, urlname)
}

// Phase 2: manual replied marks
export function getManualReplied() {
  const raw = localStorage.getItem(MANUAL_REPLIED_KEY)
  return raw ? JSON.parse(raw) : []
}

export function addManualReplied(commentId) {
  const list = getManualReplied()
  if (!list.includes(commentId)) {
    list.push(commentId)
    localStorage.setItem(MANUAL_REPLIED_KEY, JSON.stringify(list))
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
