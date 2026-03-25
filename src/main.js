import './style.css'
import { getUrlname, setUrlname, getCache, saveCache, getRangeDays, setRangeDays, getManualReplied, addManualReplied, getMutedUsers, addMutedUser, removeMutedUser, getRingVisible, setRingVisible } from './storage.js'
import { validateCreator, fetchAllArticles, fetchUpdatedComments, fetchRingUserList, fetchCreatorProfile, optOutRing, optInRing } from './api.js'
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
let showReplied = false

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

$('settingsBtn').addEventListener('click', () => {
  urlnameInput.value = getUrlname()
  rangeSelect.value = String(getRangeDays())
  renderMutedUsers()
  ringVisibleToggle.checked = getRingVisible()
  openModal(settingsModal)
})

$('settingsCancelBtn').addEventListener('click', () => closeModal(settingsModal))

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

  return articles
    .map((article) => {
      // Filter out own comments and muted users
      const otherComments = (article.comments || []).filter(
        (c) => c.user && c.user.urlname !== urlname && !mutedUrlnames.includes(c.user.urlname)
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
        unrepliedCount: classified.filter((c) => c.status !== 'replied').length,
      }
    })
    .filter((a) => a.comments.length > 0)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
}

// --- Render ---

function render() {
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

  // Check if all visible comments are replied
  let hasVisibleComments = false

  for (const article of articlesWithComments) {
    // Filter comments based on toggle
    const visibleComments = showReplied
      ? article.comments
      : article.comments.filter((c) => c.status !== 'replied')

    // Skip article if no visible comments
    if (visibleComments.length === 0) continue
    hasVisibleComments = true

    const section = document.createElement('div')
    section.className = 'article-section'

    // Article header
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

    // Comment cards
    for (const comment of visibleComments) {
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

      // Long press → mark as replied
      let longPressTimer = null
      let isLongPress = false

      function startLongPress() {
        isLongPress = false
        longPressTimer = setTimeout(() => {
          isLongPress = true
          if (comment.status !== 'replied') {
            const bodyText = parseComment(comment.body || comment.comment || '')
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

      // Tap → open note.com
      card.addEventListener('click', (e) => {
        if (isLongPress) return
        if (comment.status === 'unreplied' || comment.status === 'liked') {
          const bodyText = parseComment(comment.body || comment.comment || '')
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

      section.appendChild(card)
    }

    content.appendChild(section)
  }

  // Show chibi reward when all replied (not during refresh)
  if (!hasVisibleComments && !isRefreshing) {
    const chibiData = [
      { name: 'chibi-sun', lines: ['全部おへんじできたね。あなたなら大丈夫。', 'おつかれさま。きっと気持ちは届いてるよ。', '丁寧に返せたね。あなたらしいなぁ。', 'えらいね。また明日も一緒に頑張ろうね。', '今日もちゃんと向き合えたね。素敵だよ。'] },
      { name: 'chibi-mon', lines: ['全件返信、確認しました。完璧ですね。', '丁寧に返せましたね。その姿勢、素敵です。', '返信ゼロ件。今日のタスクは完了ですね。', '一つひとつ向き合えたこと、ちゃんと伝わってますよ。', 'お疲れさまです。あとはゆっくり休んでくださいね。'] },
      { name: 'chibi-tue', lines: ['やったー！全部おへんじできたね！', 'すごいすごい！今日も頑張ったね！', 'おへんじコンプリート！えらい！', 'みんな喜んでるよ、きっと！', '全部返せた日って気持ちいいよね！'] },
      { name: 'chibi-wed', lines: ['全部おへんじできたんだね。えらいね。', 'ゆっくりでいいんだよ。ちゃんと届いてるから。', 'おつかれさま。今日もよく頑張ったね。', 'あなたの言葉、きっと届いてるよ。', '全部返せたね。ほっとしたでしょ？'] },
      { name: 'chibi-thu', lines: ['ふーん、全部返したんだ。まあ、悪くないけど。', 'べ、別に褒めてないからね。当然のことでしょ。', 'ちゃんとやるじゃない。…見直したかも。', '全件返信？…やるじゃん。', 'まあ、サボらなかったのは認めてあげる。'] },
      { name: 'chibi-fri', lines: ['全部おへんじした！すごーい！', 'おへんじマスターだね！かっこいい！', 'やったね！これでスッキリ遊べるね！', 'ね、ね！全部終わったよ！お祝いしよ！', 'コンプリート！今日のMVPはあなた！'] },
      { name: 'chibi-sat', lines: ['全部おへんじしたね。おつかれさま。', '頑張ったね。あとはゆっくりしよ。', 'えらいえらい。今日はもう休んでいいよ。', 'おへんじ終わったね。のんびりしよ。', '全部できたんだ。…えへへ、すごいね。'] },
    ]
    const debugDay = new URLSearchParams(location.search).get('day')
    const dayIndex = debugDay !== null ? Number(debugDay) : new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' })).getDay()
    const chibi = chibiData[dayIndex]
    const chibiSrc = `${import.meta.env.BASE_URL}icons/chibi/${chibi.name}.png?v=${__APP_VERSION__}`
    const line = chibi.lines[Math.floor(Math.random() * chibi.lines.length)]

    const reward = document.createElement('div')
    reward.className = 'chibi-reward'
    reward.innerHTML = `
      <img src="${chibiSrc}" alt="" />
      <p>${escapeHtml(line)}</p>
    `
    content.appendChild(reward)
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
    '設定画面にnote IDの確認方法を追加しました。'
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
