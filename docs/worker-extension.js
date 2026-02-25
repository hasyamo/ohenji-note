/**
 * Cloudflare Worker — 統合版
 *
 * ?id=   → おはヨミ用（既存互換）
 * ?path= → コメント管理PWA用（新規）
 *
 * これで docs/worker.js を置き換えてデプロイする。
 */

const ALLOWED_PATHS = [
  '/api/v2/creators/',
  '/api/v1/note_comments',
  '/api/v3/notes/',
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // --- ?goto= (Universal Links回避リダイレクト) ---
    const gotoParam = url.searchParams.get('goto')
    if (gotoParam && gotoParam.startsWith('https://note.com/')) {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><script>location.replace(${JSON.stringify(gotoParam)})</script></head><body></body></html>`
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    // --- ?path= (コメント管理PWA用) ---
    const pathParam = url.searchParams.get('path')
    if (pathParam) {
      const allowed = ALLOWED_PATHS.some((prefix) => pathParam.startsWith(prefix))
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'Forbidden path' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const targetUrl = `https://note.com${pathParam}`
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      })

      const body = await res.text()
      return new Response(body, {
        status: res.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // --- ?id= (おはヨミ用 — 既存互換) ---
    const creatorId = url.searchParams.get('id')
    if (!creatorId) {
      return new Response(JSON.stringify({ error: 'Missing id or path parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const noteResponse = await fetch(`https://note.com/api/v2/creators/${creatorId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    })

    const data = await noteResponse.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  },
}
