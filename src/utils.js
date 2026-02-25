/**
 * Parse note.com structured comment body to plain text.
 * Comment bodies can be plain strings or structured objects.
 */
export function parseComment(body) {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return String(body || '')

  // Recursively extract text from structured nodes
  // Format: {type, value, children[], tag_name}
  function extractText(node) {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object') return ''
    if (node.type === 'text') return node.value || ''
    if (Array.isArray(node.children)) {
      return node.children.map(extractText).join('')
    }
    return ''
  }

  // Top-level: {type: "root", children: [{type: "element", children: [...], tag_name: "p"}]}
  if (Array.isArray(body.children)) {
    return body.children.map(extractText).join('\n')
  }

  if (Array.isArray(body)) {
    return body.map(extractText).join('\n')
  }

  return String(body || '')
}

/**
 * Format ISO date string to relative time in Japanese.
 */
export function relativeTime(isoDate) {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diff = now - then

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  if (hours < 24) return `${hours}時間前`
  if (days < 7) return `${days}日前`
  if (days < 30) return `${Math.floor(days / 7)}週間前`
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`
  return `${Math.floor(days / 365)}年前`
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

/**
 * Sleep for rate limiting.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
