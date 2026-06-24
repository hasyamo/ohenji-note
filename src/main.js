import './style.css'
import { getUrlname, setUrlname, getCache, saveCache, getRangeDays, setRangeDays, getManualReplied, addManualReplied, getMutedUsers, addMutedUser, removeMutedUser, getRingVisible, setRingVisible, getLegacyCommentsVisible, setLegacyCommentsVisible, getViewMode, setViewMode } from './storage.js'
import { validateCreator, fetchAllArticles, fetchUpdatedComments, fetchRingUserList, fetchCreatorProfile, optOutRing, optInRing } from './api.js'
import { parseComment, relativeTime, escapeHtml } from './utils.js'
import { processComments as processCommentsCore } from './lib/process-comments.js'
import { shouldShowPraise } from './lib/should-show-praise.js'

// --- Interaction tracking (for manualReplied 異常検知) ---
const interactionState = {
  clickSeq: 0,
  currentEventId: null,
  lastEventAt: null,
}

function makeEventId(seq) {
  const rand = Math.random().toString(36).slice(2, 8)
  return `click_${Date.now()}_${seq}_${rand}`
}

document.addEventListener('click', () => {
  interactionState.clickSeq += 1
  interactionState.lastEventAt = new Date().toISOString()
  interactionState.currentEventId = makeEventId(interactionState.clickSeq)
}, true)

function getManualRepliedContext() {
  return {
    now: new Date().toISOString(),
    source: 'reply-button',
    clickSeq: interactionState.clickSeq,
    eventId: interactionState.currentEventId,
    appVersion: __APP_VERSION__,
    buildHash: null,
  }
}
import charactersData from './rewards/characters.json'
import collabPeriods from './rewards/collab/periods.json'

// Load all collab character files via glob (keyed by file path)
const collabModules = import.meta.glob('./rewards/collab/*.json', { eager: true, import: 'default' })

// Build a map: period id -> character array
function getCollabCharacters(periodId) {
  for (const [path, data] of Object.entries(collabModules)) {
    const fileName = path.split('/').pop().replace('.json', '')
    if (fileName === periodId) return data
  }
  return null
}

// --- Reward selection (unreplied-zero chibi演出) ---

// Return JST weekday (0=Sun..6=Sat), overridable via ?day=N
function getWeekdayJst() {
  const debugDay = new URLSearchParams(location.search).get('day')
  if (debugDay !== null) return Number(debugDay)
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getDay()
}

// Return JST date string YYYY-MM-DD, overridable via ?date=YYYY-MM-DD
function getDateStringJst() {
  const debugDate = new URLSearchParams(location.search).get('date')
  if (debugDate) return debugDate
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Deterministic string -> unsigned 32bit hash (FNV-1a)
function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Seeded shuffle (Fisher-Yates)
function seededShuffle(arr, seed) {
  const result = [...arr]
  let s = seed
  for (let i = result.length - 1; i > 0; i--) {
    s = hashString(String(s) + ':' + i)
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

// Get all Thursdays in a given year/month
function getThursdays(year, month) {
  const result = []
  const d = new Date(Date.UTC(year, month - 1, 1))
  while (d.getUTCMonth() === month - 1) {
    if (d.getUTCDay() === 4) {
      const str = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
      result.push(str)
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return result
}

// For weekdays with multiple candidates (e.g. Thursday: rinka + rinka-suzu),
// use monthly shuffle to guarantee at least 1 appearance per month.
// Returns the character id for the given date.
function pickCharacterForDate(dateStr, candidates) {
  if (candidates.length === 1) return candidates[0]

  // Only apply monthly shuffle when there are exactly 2 candidates with different weights
  const primary = candidates.find((c) => c.weight >= 0.5)
  const rare = candidates.find((c) => c.weight < 0.5)
  if (!primary || !rare) {
    // Fallback: simple seed-based pick
    const seed = hashString(`${dateStr}:char`)
    return candidates[seed % candidates.length]
  }

  // Get the year/month from dateStr
  const [y, m] = dateStr.split('-').map(Number)
  const thursdays = getThursdays(y, m)
  if (thursdays.length === 0) return primary

  // Determine how many times the rare character appears this month (90%: 1, 10%: 2)
  const monthSeed = hashString(`${y}-${String(m).padStart(2, '0')}:suzu-schedule`)
  const rareCount = Math.min((monthSeed % 10000) / 10000 < 0.9 ? 1 : 2, thursdays.length)

  // Build slots and shuffle
  const slots = []
  for (let i = 0; i < rareCount; i++) slots.push(rare.id)
  for (let i = rareCount; i < thursdays.length; i++) slots.push(primary.id)
  const shuffled = seededShuffle(slots, monthSeed)

  // Find today's index
  const todayIndex = thursdays.indexOf(dateStr)
  if (todayIndex < 0) return primary

  const pickedId = shuffled[todayIndex]
  return candidates.find((c) => c.id === pickedId) || primary
}

// Find active collab period for a given date string (YYYY-MM-DD)
function findActivePeriod(dateStr) {
  for (const period of collabPeriods) {
    if (dateStr >= period.start && dateStr <= period.end) return period
  }
  return null
}

// Group flat character list into per-creator buckets while preserving order.
function groupByCreator(chars) {
  const order = []
  const buckets = new Map()
  for (const c of chars) {
    const key = c.creator
    if (!buckets.has(key)) {
      buckets.set(key, [])
      order.push(key)
    }
    buckets.get(key).push(c)
  }
  return order.map((k) => buckets.get(k))
}

// 2-stage rotation:
//   1. creatorIndex = daysSinceStart % creators.length  → pick creator bucket
//   2. characterIndex = (creator-appearance count so far) % bucket.length  → pick char
//   3. lineIndex = (character-appearance count so far) % lines.length  → pick line (deterministic, cycles)
function pickCollabReward(period, collabChars, dateStr) {
  const startDate = new Date(period.start + 'T00:00:00Z')
  const todayDate = new Date(dateStr + 'T00:00:00Z')
  const daysSinceStart = Math.floor((todayDate - startDate) / 86400000)
  if (daysSinceStart < 0) return null

  const creatorBuckets = groupByCreator(collabChars)
  if (creatorBuckets.length === 0) return null

  const creatorIndex = daysSinceStart % creatorBuckets.length
  const bucket = creatorBuckets[creatorIndex]

  // How many times has this creator's bucket been picked up to today (inclusive)?
  // Equivalent to floor(daysSinceStart / creators.length) + 1, then -1 to get 0-indexed.
  const creatorAppearances = Math.floor(daysSinceStart / creatorBuckets.length)
  const characterIndex = creatorAppearances % bucket.length
  const character = bucket[characterIndex]

  // Character appearances so far (0-indexed): how many times this character has been picked.
  // Within a creator bucket, the same character is picked every bucket.length times the creator is picked,
  // i.e. once every (creatorBuckets.length * bucket.length) days, starting from
  // dayOffset = creatorIndex + characterIndex * creatorBuckets.length.
  const cycleLen = creatorBuckets.length * bucket.length
  const charAppearances = Math.floor(daysSinceStart / cycleLen)

  const lineIndex = charAppearances % character.lines.length
  const variation = character.lines[lineIndex]

  return {
    character: { fileName: character.fileName, name: character.name, isCollab: true },
    variation,
    credit: { creator: character.creator, noteURL: character.noteURL },
    periodId: period.id,
  }
}

// Pick today's reward (character + one line variation)
// Returns { character, variation, credit } where credit is null for builtin characters
function pickReward() {
  const weekday = getWeekdayJst()
  const dateStr = getDateStringJst()

  // Check collab period first
  const period = findActivePeriod(dateStr)
  if (period) {
    const collabChars = getCollabCharacters(period.id)
    if (collabChars && collabChars.length > 0) {
      const result = pickCollabReward(period, collabChars, dateStr)
      if (result) return result
    }
  }

  // Fallback: builtin characters
  const candidates = charactersData.filter((c) => c.weekday === weekday)
  if (candidates.length === 0) return null

  const character = pickCharacterForDate(dateStr, candidates)

  const lineSeed = hashString(`${dateStr}:${character.id}:line`)
  const variation = character.lines[lineSeed % character.lines.length]

  return { character, variation, credit: null }
}

// --- Collab analytics ---

const COLLAB_EVENT_URL = 'https://falling-mouse-736b.hasyamo.workers.dev/api/ohenjicho/collab_event'

// Fire-and-forget: send a small JSON payload.
// Uses text/plain to avoid CORS preflight (simple request).
function trackCollabEvent(payload) {
  try {
    const data = JSON.stringify(payload)
    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'text/plain' })
      navigator.sendBeacon(COLLAB_EVENT_URL, blob)
      return
    }
    fetch(COLLAB_EVENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: data,
      credentials: 'omit',
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Never fail the UI because of analytics
  }
}

// Render a line variation (array of strings) into HTML
// If a string contains a full-width colon "：", split into speaker + body
function renderLinesHtml(variation) {
  return variation
    .map((line) => {
      const idx = line.indexOf('：')
      if (idx >= 0) {
        const speaker = line.slice(0, idx)
        const body = line.slice(idx + 1)
        return `<p class="chibi-reward__line"><span class="chibi-reward__speaker">${escapeHtml(speaker)}</span>${escapeHtml(body)}</p>`
      }
      return `<p class="chibi-reward__line">${escapeHtml(line)}</p>`
    })
    .join('')
}

// --- DOM refs ---
const $ = (id) => document.getElementById(id)

const summaryBar = $('summaryBar')
const summaryText = $('summaryText')
const loading = $('loading')
const loadingText = $('loadingText')
const content = $('content')
const emptyState = $('emptyState')
const refreshBtn = $('refreshBtn')
const settingsModal = $('settingsModal')
const urlnameInput = $('urlnameInput')

// --- State ---
let articlesWithComments = []
let isRefreshing = false
let pendingComment = null // {commentKey, articleKey, commentBody}
let showReplied = false
let viewMode = getViewMode() // 'articles' or 'comments'

// --- Modal helpers ---

function openModal(overlay) {
  overlay.classList.add('active')
}

function closeModal(overlay) {
  overlay.classList.remove('active')
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay)
  })
})

// iOS keyboard
if (visualViewport) {
  visualViewport.addEventListener('resize', () => {
    const el = document.activeElement
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100)
    }
  })
}

// --- Settings error ---

const settingsError = $('settingsError')

function showSettingsError(msg) {
  settingsError.textContent = msg
  settingsError.hidden = false
}

function clearSettingsError() {
  settingsError.textContent = ''
  settingsError.hidden = true
}

// --- Settings ---

const rangeSelect = $('rangeSelect')

const mutedUsersList = $('mutedUsersList')

function renderMutedUsers() {
  const muted = getMutedUsers()
  if (muted.length === 0) {
    mutedUsersList.innerHTML = '<span class="muted-empty">なし</span>'
    return
  }
  mutedUsersList.innerHTML = muted.map((u) =>
    `<div class="muted-item"><span>${escapeHtml(u.nickname || u.urlname)}</span><button class="muted-remove" data-urlname="${escapeHtml(u.urlname)}">✕</button></div>`
  ).join('')
  mutedUsersList.querySelectorAll('.muted-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      removeMutedUser(btn.dataset.urlname)
      renderMutedUsers()
      const urlname = getUrlname()
      const cached = getCache(urlname)
      if (cached) {
        articlesWithComments = processComments(cached, urlname)
        render()
      }
    })
  })
}

const ringVisibleToggle = $('ringVisibleToggle')
const legacyCommentsToggle = $('legacyCommentsToggle')

$('settingsBtn').addEventListener('click', () => {
  urlnameInput.value = getUrlname()
  rangeSelect.value = String(getRangeDays())
  renderMutedUsers()
  ringVisibleToggle.checked = getRingVisible()
  legacyCommentsToggle.checked = getLegacyCommentsVisible()
  openModal(settingsModal)
})

$('settingsCancelBtn').addEventListener('click', () => closeModal(settingsModal))

// --- サポートデータコピー ---

$('supportCopyBtn').addEventListener('click', async () => {
  const btn = $('supportCopyBtn')
  const originalText = btn.textContent
  try {
    const urlname = getUrlname()
    const cache = getCache(urlname) || []
    const manualReplied = getManualReplied()
    const muted = getMutedUsers()

    // キャッシュは要約だけ抜粋（コメント本文は含めない）
    const articles = cache.map((a) => ({
      key: a.key,
      title: (a.title || '').slice(0, 60),
      publishedAt: a.publishedAt,
      commentCount: a.commentCount,
      cachedCommentCount: (a.comments || []).length,
      comments: (a.comments || []).map((c) => ({
        key: c.key,
        user: c.user?.urlname,
        is_creator_replied: c.is_creator_replied,
        is_creator_liked: c.is_creator_liked,
        legacy: !!c._legacy,
      })),
    }))

    // 統計
    const allComments = articles.flatMap((a) => a.comments)
    const stats = {
      articleCount: articles.length,
      totalComments: allComments.length,
      uniqueCommentKeys: new Set(allComments.map((c) => c.key)).size,
      nullishKeys: allComments.filter((c) => c.key == null || c.key === '').length,
      creatorReplied: allComments.filter((c) => c.is_creator_replied).length,
      creatorLiked: allComments.filter((c) => c.is_creator_liked).length,
      manualRepliedCount: manualReplied.length,
      manualRepliedNullish: manualReplied.filter((x) => x == null || x === '').length,
    }

    const data = {
      appVersion: __APP_VERSION__,
      exportedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      settings: {
        urlname,
        rangeDays: getRangeDays(),
        ringVisible: getRingVisible(),
        legacyCommentsVisible: getLegacyCommentsVisible(),
        viewMode: getViewMode(),
        mutedUsers: muted,
      },
      stats,
      manualReplied,
      articles,
    }
    const json = JSON.stringify(data, null, 2)
    let copied = false
    try {
      await navigator.clipboard.writeText(json)
      copied = true
    } catch {
      const ta = document.createElement('textarea')
      ta.value = json
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      try { copied = document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
    }
    btn.textContent = copied ? 'コピーしました' : 'コピー失敗'
    setTimeout(() => { btn.textContent = originalText }, 2000)
  } catch (err) {
    btn.textContent = 'コピー失敗'
    setTimeout(() => { btn.textContent = originalText }, 2000)
  }
})

const saveBtn = $('settingsSaveBtn')

saveBtn.addEventListener('click', async () => {
  const urlname = urlnameInput.value.trim()
  if (!urlname) return
  clearSettingsError()
  saveBtn.disabled = true
  saveBtn.textContent = '確認中...'

  try {
    await validateCreator(urlname)
    setUrlname(urlname)
    setRangeDays(Number(rangeSelect.value))
    // Ring visible toggle
    const newRingVisible = ringVisibleToggle.checked
    const wasRingVisible = getRingVisible()
    setRingVisible(newRingVisible)
    if (wasRingVisible && !newRingVisible) {
      await optOutRing(urlname).catch(() => {})
    } else if (!wasRingVisible && newRingVisible) {
      await optInRing(urlname).catch(() => {})
    }
    // Legacy comments toggle: clear cache when changed to force refetch
    const newLegacyVisible = legacyCommentsToggle.checked
    const wasLegacyVisible = getLegacyCommentsVisible()
    setLegacyCommentsVisible(newLegacyVisible)
    if (newLegacyVisible !== wasLegacyVisible) {
      saveCache(urlname, [])
    }
    closeModal(settingsModal)
    refresh()
  } catch (err) {
    const msg = err.message.includes('404')
      ? 'クリエータが見つかりません。名前を確認してください。'
      : `取得に失敗しました: ${err.message}`
    showSettingsError(msg)
  } finally {
    saveBtn.disabled = false
    saveBtn.textContent = '保存'
  }
})

// --- Toggle replied ---

$('toggleRepliedBtn').addEventListener('click', () => {
  showReplied = !showReplied
  render()
})

// --- View mode toggle ---

$('viewModeBtn').addEventListener('click', () => {
  viewMode = viewMode === 'articles' ? 'comments' : 'articles'
  setViewMode(viewMode)
  render()
})

// --- Refresh ---

refreshBtn.addEventListener('click', () => {
  if (!isRefreshing) refresh()
})

async function refresh() {
  const urlname = getUrlname()
  if (!urlname) {
    openModal(settingsModal)
    return
  }

  isRefreshing = true
  refreshBtn.classList.add('refreshing')

  const cachedArticles = getCache(urlname)
  const hasCache = cachedArticles && cachedArticles.length > 0

  // Show cache immediately if available
  if (hasCache && articlesWithComments.length === 0) {
    articlesWithComments = processComments(cachedArticles, urlname)
    render()
  }

  // Show loading only if no cache
  if (!hasCache) {
    loading.hidden = false
    content.hidden = true
    summaryBar.hidden = true
  }

  try {
    const rangeDays = getRangeDays()
    const articles = await fetchAllArticles(urlname, rangeDays, (msg) => {
      loadingText.textContent = msg
    })

    const legacyVisible = getLegacyCommentsVisible()
    const enriched = await fetchUpdatedComments(articles, cachedArticles, urlname, legacyVisible, (msg) => {
      loadingText.textContent = msg
    })

    saveCache(urlname, enriched)
    articlesWithComments = processComments(enriched, urlname)
  } catch (err) {
    if (!hasCache) {
      content.innerHTML = `<div class="error-banner">エラー: ${escapeHtml(err.message)}</div>`
      content.hidden = false
    }
  }

  loading.hidden = true
  content.hidden = false
  isRefreshing = false
  refreshBtn.classList.remove('refreshing')
  render()
}

// --- Process comments ---

function processComments(articles, urlname) {
  const manualReplied = getManualReplied()
  const mutedUrlnames = getMutedUsers().map((u) => u.urlname)
  return processCommentsCore(articles, urlname, manualReplied, mutedUrlnames)
}

// --- Render ---

function render() {
  // Debug: ?reward=1 forces the reward to be displayed regardless of unreplied count
  const forceReward = new URLSearchParams(location.search).get('reward') === '1'

  // Summary
  const totalUnreplied = articlesWithComments.reduce((sum, a) => sum + a.unrepliedCount, 0)
  const totalComments = articlesWithComments.reduce((sum, a) => sum + a.comments.length, 0)
  const totalReplied = totalComments - totalUnreplied

  // Badge
  document.title = totalUnreplied > 0 ? `(${totalUnreplied}) おへんじ帖` : 'おへんじ帖'
  if (navigator.setAppBadge) {
    if (totalUnreplied > 0) {
      navigator.setAppBadge(totalUnreplied)
    } else {
      navigator.clearAppBadge()
    }
  }

  const toggleBtn = $('toggleRepliedBtn')

  if (totalComments > 0) {
    summaryBar.hidden = false
    if (totalUnreplied > 0) {
      summaryText.textContent = `${totalUnreplied}件の未返信コメント`
      summaryBar.style.background = 'var(--status-unreplied-bg)'
      summaryBar.style.color = 'var(--status-unreplied)'
    } else {
      summaryText.textContent = 'すべて返信済み'
      summaryBar.style.background = 'var(--status-replied-bg)'
      summaryBar.style.color = 'var(--status-replied)'
    }
    toggleBtn.textContent = showReplied ? '未返信のみ' : `返信済み ${totalReplied}件`
    toggleBtn.hidden = totalReplied === 0
    const viewModeBtn = $('viewModeBtn')
    viewModeBtn.textContent = viewMode === 'articles' ? '記事順' : 'コメント順'
  } else {
    summaryBar.hidden = true
  }

  // Collab banner: visible while an active collab period is running
  const collabBanner = $('collabBanner')
  const activePeriod = findActivePeriod(getDateStringJst())
  if (activePeriod) {
    const fmt = (s) => {
      const [, m, d] = s.split('-').map(Number)
      return `${m}/${d}`
    }
    collabBanner.textContent = `おへんじ帖 ${activePeriod.name} ✨ ${fmt(activePeriod.start)} - ${fmt(activePeriod.end)}`
    collabBanner.hidden = false
  } else {
    collabBanner.hidden = true
  }

  // Content
  if (articlesWithComments.length === 0) {
    content.innerHTML = ''
    emptyState.hidden = false
    emptyState.innerHTML = '<p>コメントのある記事がありません</p>'
    content.appendChild(emptyState)
    return
  }

  content.innerHTML = ''

  // Helper to create a comment card element
  function createCommentCard(comment, article, includeArticleTitle) {
    const card = document.createElement('div')
    card.className = 'comment-card'

    const statusLabel = {
      unreplied: '未返信',
      liked: 'いいね済',
      replied: '返信済',
    }[comment.status]

    const statusClass = `status-badge--${comment.status}`

    const avatarUrl = comment.user?.profile_image_url
    const avatarContent = avatarUrl
      ? `<img src="${encodeURI(avatarUrl)}" alt="" />`
      : '👤'

    const bodyText = parseComment(comment.body || comment.comment || '')

    const articleTitleHtml = includeArticleTitle
      ? `<div class="comment-article-title">${escapeHtml(article.title)}</div>`
      : ''

    card.innerHTML = `
      <div class="comment-avatar">${avatarContent}</div>
      <div class="comment-body">
        ${articleTitleHtml}
        <div class="comment-meta">
          <span class="comment-author">${escapeHtml(comment.user?.nickname || comment.user?.urlname || '匿名')}</span>
          <span class="comment-time">${relativeTime(comment.created_at)}</span>
        </div>
        <p class="comment-text">${escapeHtml(bodyText)}</p>
      </div>
      <div class="comment-status">
        <span class="status-badge ${statusClass}">${statusLabel}</span>
      </div>
    `

    let longPressTimer = null
    let isLongPress = false

    function startLongPress() {
      isLongPress = false
      longPressTimer = setTimeout(() => {
        isLongPress = true
        if (comment.status !== 'replied') {
          pendingComment = {
            commentKey: comment.key,
            articleKey: article.key,
            commentBody: bodyText,
            userUrlname: comment.user?.urlname,
            userNickname: comment.user?.nickname || comment.user?.urlname || '匿名',
          }
          openModal(replyModal)
          replyTarget.textContent = bodyText
          muteUserBtn.textContent = `${pendingComment.userNickname} を非表示`
        }
      }, 500)
    }

    function cancelLongPress() {
      clearTimeout(longPressTimer)
    }

    card.addEventListener('touchstart', startLongPress, { passive: true })
    card.addEventListener('touchend', cancelLongPress)
    card.addEventListener('touchmove', cancelLongPress)
    card.addEventListener('mousedown', startLongPress)
    card.addEventListener('mouseup', cancelLongPress)
    card.addEventListener('mouseleave', cancelLongPress)

    card.addEventListener('click', (e) => {
      if (isLongPress) return
      if (comment.status === 'unreplied' || comment.status === 'liked') {
        pendingComment = {
          commentKey: comment.key,
          articleKey: article.key,
          commentBody: bodyText,
          userUrlname: comment.user?.urlname,
          userNickname: comment.user?.nickname || comment.user?.urlname || '匿名',
        }
        sessionStorage.setItem('ncm_pending', JSON.stringify(pendingComment))
      }
      const noteUrl = `https://note.com/${encodeURIComponent(article.urlname)}/n/${encodeURIComponent(article.key)}?scrollpos=comment&c=${encodeURIComponent(comment.key)}`
      window.open(noteUrl, '_blank')
    })

    return card
  }

  // Check if all visible comments are replied
  let hasVisibleComments = false

  // Debug: ?reward=1 → skip rendering the list entirely (force-show reward only)
  if (!forceReward) {
    if (viewMode === 'comments') {
      // Flat by comment date
      const flat = []
      for (const article of articlesWithComments) {
        const visibleComments = showReplied
          ? article.comments
          : article.comments.filter((c) => c.status !== 'replied')
        for (const c of visibleComments) {
          flat.push({ comment: c, article })
        }
      }
      flat.sort((a, b) => new Date(b.comment.created_at) - new Date(a.comment.created_at))

      if (flat.length > 0) {
        hasVisibleComments = true
        const section = document.createElement('div')
        section.className = 'article-section'
        for (const { comment, article } of flat) {
          section.appendChild(createCommentCard(comment, article, true))
        }
        content.appendChild(section)
      }
    } else {
      // Group by article (default)
      for (const article of articlesWithComments) {
        const visibleComments = showReplied
          ? article.comments
          : article.comments.filter((c) => c.status !== 'replied')

        if (visibleComments.length === 0) continue
        hasVisibleComments = true

        const section = document.createElement('div')
        section.className = 'article-section'

        const header = document.createElement('div')
        header.className = 'article-header'

        const countClass = article.unrepliedCount > 0 ? 'article-count--unreplied' : 'article-count--all-done'
        const countLabel = article.unrepliedCount > 0
          ? `${article.unrepliedCount}件未返信`
          : '返信済み'

        header.innerHTML = `
          <span class="article-title">${escapeHtml(article.title)}</span>
          <span class="article-count ${countClass}">${countLabel}</span>
        `
        section.appendChild(header)

        for (const comment of visibleComments) {
          section.appendChild(createCommentCard(comment, article, false))
        }

        content.appendChild(section)
      }
    }
  }

  // Show chibi reward when all replied (not during refresh)
  if (shouldShowPraise(articlesWithComments, { isRefreshing, forceReward })) {
    const picked = pickReward()
    if (picked) {
      const { character, variation, credit, periodId } = picked
      const chibiDir = character.isCollab ? 'icons/chibi/collab/' : 'icons/chibi/'
      const chibiSrc = `${import.meta.env.BASE_URL}${chibiDir}${character.fileName}?v=${__APP_VERSION__}`

      const creditHtml = credit
        ? `<a class="chibi-reward__credit" href="${escapeHtml(credit.noteURL)}" target="_blank" rel="noopener">by ${escapeHtml(credit.creator)}｜noteへ</a>`
        : ''

      const reward = document.createElement('div')
      reward.className = 'chibi-reward'
      reward.innerHTML = `
        <img src="${chibiSrc}" alt="" />
        <div class="chibi-reward__text">${renderLinesHtml(variation)}</div>
        ${creditHtml}
      `
      content.appendChild(reward)

      // Analytics: collab view event (dedupe per day per character via sessionStorage)
      if (character.isCollab && credit && periodId) {
        const dateStr = getDateStringJst()
        const dedupeKey = `ncm_collab_view:${periodId}:${dateStr}:${credit.creator}:${character.name || ''}`
        if (!sessionStorage.getItem(dedupeKey)) {
          sessionStorage.setItem(dedupeKey, '1')
          trackCollabEvent({
            event: 'view',
            periodId,
            creator: credit.creator,
            character: character.name || '',
            date: dateStr,
          })
        }
      }

      // Analytics: collab credit click event (separate from comment-card tap)
      if (character.isCollab && credit && periodId) {
        const creditEl = reward.querySelector('.chibi-reward__credit')
        if (creditEl) {
          creditEl.addEventListener('click', () => {
            trackCollabEvent({
              event: 'click',
              periodId,
              creator: credit.creator,
              character: character.name || '',
              date: getDateStringJst(),
            })
          })
        }
      }
    }
  }
}

// --- Return detection & reply confirm ---

const replyModal = $('replyModal')
const replyTarget = $('replyTarget')
const muteUserBtn = $('muteUserBtn')

function handleReturn() {
  const raw = sessionStorage.getItem('ncm_pending')
  if (!raw) return
  sessionStorage.removeItem('ncm_pending')

  const pending = JSON.parse(raw)
  replyTarget.textContent = pending.commentBody
  pendingComment = pending
  muteUserBtn.textContent = `${pending.userNickname || 'このユーザー'} を非表示`
  openModal(replyModal)
}

$('replyYesBtn').addEventListener('click', () => {
  if (pendingComment) {
    addManualReplied(pendingComment.commentKey, getManualRepliedContext())
    pendingComment = null
  }
  closeModal(replyModal)
  // Re-process and render with updated manual replied
  const urlname = getUrlname()
  const cached = getCache(urlname)
  if (cached) {
    articlesWithComments = processComments(cached, urlname)
    render()
  }
})

$('replyNoBtn').addEventListener('click', () => {
  pendingComment = null
  closeModal(replyModal)
})

muteUserBtn.addEventListener('click', () => {
  if (pendingComment && pendingComment.userUrlname) {
    addMutedUser(pendingComment.userUrlname, pendingComment.userNickname)
    pendingComment = null
    closeModal(replyModal)
    const urlname = getUrlname()
    const cached = getCache(urlname)
    if (cached) {
      articlesWithComments = processComments(cached, urlname)
      render()
    }
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    handleReturn()
  }
})

window.addEventListener('focus', () => {
  handleReturn()
})

// --- おへんじ帖の輪 ---

const ringModal = $('ringModal')
const ringContent = $('ringContent')

$('ringBtn').addEventListener('click', () => {
  openModal(ringModal)
  loadRingUsers()
})

$('ringCloseBtn').addEventListener('click', () => closeModal(ringModal))

async function loadRingUsers() {
  ringContent.innerHTML = '<p class="ring-loading">読み込み中...</p>'
  try {
    const urlnames = await fetchRingUserList()
    const ringDesc = document.getElementById('ringDescription')
    if (urlnames.length === 0) {
      ringContent.innerHTML = '<p class="ring-empty">まだメンバーがいません</p>'
      if (ringDesc) ringDesc.textContent = 'コメントを大切にするクリエーターたち'
      return
    }
    if (ringDesc) ringDesc.textContent = `コメントを大切にする${urlnames.length}名のクリエーターたち`

    ringContent.innerHTML = ''
    for (const urlname of urlnames) {
      try {
        const profile = await fetchCreatorProfile(urlname)
        const card = document.createElement('a')
        card.className = 'ring-card'
        card.href = `https://note.com/${encodeURIComponent(profile.urlname)}`
        card.target = '_blank'
        card.rel = 'noopener'

        const avatarContent = profile.avatarUrl
          ? `<img src="${encodeURI(profile.avatarUrl)}" alt="" class="ring-avatar-img" />`
          : '<div class="ring-avatar-placeholder">👤</div>'

        card.innerHTML = `
          <div class="ring-avatar">${avatarContent}</div>
          <div class="ring-info">
            <span class="ring-nickname">${escapeHtml(profile.nickname || profile.urlname)}</span>
            <span class="ring-urlname">@${escapeHtml(profile.urlname)}</span>
          </div>
        `
        ringContent.appendChild(card)
      } catch {
        // 取得失敗はスキップ
      }
    }
  } catch (err) {
    ringContent.innerHTML = `<p class="ring-empty">読み込みに失敗しました</p>`
  }
}

// --- バージョンアップ通知 ---

const VERSION_KEY = 'ncm_last_seen_version'

function checkVersionUpdate() {
  const lastSeen = localStorage.getItem(VERSION_KEY)
  if (lastSeen !== __APP_VERSION__) {
    showUpdateModal()
  }
}

function showUpdateModal() {
  const updateModal = $('updateModal')
  $('updateBody').textContent =
    '不具合調査のための機能を追加しました。'
  openModal(updateModal)
  $('updateCloseBtn').addEventListener('click', () => {
    localStorage.setItem(VERSION_KEY, __APP_VERSION__)
    closeModal(updateModal)
  }, { once: true })
}

// --- Service Worker ---

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + `sw.js?v=${__APP_VERSION__}`)
}

// --- Version ---

$('appVersion').textContent = `おへんじ帖 v${__APP_VERSION__}`

// --- Init ---

checkVersionUpdate()

if (!getUrlname()) {
  openModal(settingsModal)
} else {
  refresh()
}
