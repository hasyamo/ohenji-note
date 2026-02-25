import './style.css'
import { getUrlname, setUrlname, getCache, saveCache, getRangeDays, setRangeDays, getManualReplied, addManualReplied } from './storage.js'
import { fetchAllArticles, fetchUpdatedComments, PROXY_URL } from './api.js'
import { parseComment, relativeTime, escapeHtml } from './utils.js'

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

// --- Settings ---

const rangeSelect = $('rangeSelect')

$('settingsBtn').addEventListener('click', () => {
  urlnameInput.value = getUrlname()
  rangeSelect.value = String(getRangeDays())
  openModal(settingsModal)
})

$('settingsCancelBtn').addEventListener('click', () => closeModal(settingsModal))

$('settingsSaveBtn').addEventListener('click', () => {
  const urlname = urlnameInput.value.trim()
  if (!urlname) return
  setUrlname(urlname)
  setRangeDays(Number(rangeSelect.value))
  closeModal(settingsModal)
  refresh()
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

    const enriched = await fetchUpdatedComments(articles, cachedArticles, (msg) => {
      loadingText.textContent = msg
    })

    saveCache(urlname, enriched)
    articlesWithComments = processComments(enriched, urlname)
    render()
  } catch (err) {
    if (!hasCache) {
      content.innerHTML = `<div class="error-banner">エラー: ${escapeHtml(err.message)}</div>`
    }
  }

  loading.hidden = true
  content.hidden = false
  isRefreshing = false
  refreshBtn.classList.remove('refreshing')
}

// --- Process comments ---

function processComments(articles, urlname) {
  const manualReplied = getManualReplied()

  return articles
    .map((article) => {
      // Filter out own comments
      const otherComments = (article.comments || []).filter(
        (c) => c.user && c.user.urlname !== urlname
      )

      // Classify each comment
      const classified = otherComments.map((c) => {
        let status = 'unreplied'
        if (c.is_creator_replied || manualReplied.includes(c.key)) {
          status = 'replied'
        } else if (c.is_creator_liked) {
          status = 'liked'
        }
        return { ...c, status }
      })

      // Sort: unreplied first, then liked, then replied
      const order = { unreplied: 0, liked: 1, replied: 2 }
      classified.sort((a, b) => order[a.status] - order[b.status])

      return {
        ...article,
        comments: classified,
        unrepliedCount: classified.filter((c) => c.status === 'unreplied').length,
      }
    })
    .filter((a) => a.comments.length > 0)
    .sort((a, b) => b.unrepliedCount - a.unrepliedCount)
}

// --- Render ---

function render() {
  // Summary
  const totalUnreplied = articlesWithComments.reduce((sum, a) => sum + a.unrepliedCount, 0)
  const totalComments = articlesWithComments.reduce((sum, a) => sum + a.comments.length, 0)

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
  } else {
    summaryBar.hidden = true
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

  for (const article of articlesWithComments) {
    const section = document.createElement('div')
    section.className = 'article-section'

    // Article header
    const header = document.createElement('div')
    header.className = 'article-header'

    const countClass = article.unrepliedCount > 0 ? 'article-count--unreplied' : 'article-count--all-done'
    const countLabel = article.unrepliedCount > 0
      ? `${article.unrepliedCount}件未返信`
      : '対応済み'

    header.innerHTML = `
      <span class="article-title">${escapeHtml(article.title)}</span>
      <span class="article-count ${countClass}">${countLabel}</span>
    `
    section.appendChild(header)

    // Comment cards
    for (const comment of article.comments) {
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

      card.innerHTML = `
        <div class="comment-avatar">${avatarContent}</div>
        <div class="comment-body">
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

      // Deep link to note.com comment
      card.addEventListener('click', () => {
        if (comment.status === 'unreplied' || comment.status === 'liked') {
          const bodyText = parseComment(comment.body || comment.comment || '')
          pendingComment = {
            commentKey: comment.key,
            articleKey: article.key,
            commentBody: bodyText,
          }
          sessionStorage.setItem('ncm_pending', JSON.stringify(pendingComment))
        }
        const noteUrl = `https://note.com/${encodeURIComponent(article.urlname)}/n/${encodeURIComponent(article.key)}?scrollpos=comment&c=${encodeURIComponent(comment.key)}`
        // Universal Links回避: CFワーカー経由でJSリダイレクト
        window.open(`${PROXY_URL}?goto=${encodeURIComponent(noteUrl)}`, '_blank')
      })

      section.appendChild(card)
    }

    content.appendChild(section)
  }
}

// --- Return detection & reply confirm ---

const replyModal = $('replyModal')
const replyTarget = $('replyTarget')

function handleReturn() {
  const raw = sessionStorage.getItem('ncm_pending')
  if (!raw) return
  sessionStorage.removeItem('ncm_pending')

  const pending = JSON.parse(raw)
  replyTarget.textContent = pending.commentBody
  pendingComment = pending
  openModal(replyModal)
}

$('replyYesBtn').addEventListener('click', () => {
  if (pendingComment) {
    addManualReplied(pendingComment.commentKey)
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

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    handleReturn()
  }
})

window.addEventListener('focus', () => {
  handleReturn()
})

// --- Service Worker ---

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js')
}

// --- Init ---

if (!getUrlname()) {
  openModal(settingsModal)
} else {
  refresh()
}
