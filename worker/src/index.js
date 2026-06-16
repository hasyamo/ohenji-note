/**
 * Cloudflare Worker — 統合版
 *
 * ?id=   → おはヨミ用（既存互換）
 * ?path= → コメント管理PWA用（新規）
 * /api/ohenjicho/users → おへんじ帖の輪 ユーザー一覧
 *
 * KV binding: wrangler.toml に以下を追加
 *   [[kv_namespaces]]
 *   binding = "KV"
 *   id = "<KV namespace ID>"
 */

const ALLOWED_PATHS = [
  '/api/v2/creators/',
  '/api/v1/note_comments',
  '/api/v3/notes/',
]

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // --- おへんじ帖の輪 API ---
    if (url.pathname === '/api/ohenjicho/users') {
      if (request.method === 'GET') {
        return handleListUsers(env)
      }
    }


    if (url.pathname === '/api/ohenjicho/users/export' && request.method === 'GET') {
      return handleExportUsers(env, url)
    }

    if (url.pathname === '/api/ohenjicho/cleanup' && request.method === 'GET') {
      return handleCleanup(env)
    }

    // --- コラボ計測 ---
    if (url.pathname === '/api/ohenjicho/collab_event' && request.method === 'POST') {
      return handleCollabEvent(request, env)
    }
    if (url.pathname === '/api/ohenjicho/collab_stats' && request.method === 'GET') {
      return handleCollabStats(env, url)
    }
    if (url.pathname === '/api/ohenjicho/collab_export' && request.method === 'GET') {
      return handleCollabExport(env, url)
    }
    if (url.pathname === '/api/ohenjicho/collab_reset' && request.method === 'POST') {
      return handleCollabReset(env, url)
    }

    const ringMatch = url.pathname.match(/^\/api\/ohenjicho\/users\/(.+)$/)
    if (ringMatch && request.method === 'DELETE') {
      return handleOptOut(decodeURIComponent(ringMatch[1]), env)
    }
    if (ringMatch && request.method === 'PUT') {
      return handleOptIn(decodeURIComponent(ringMatch[1]), env)
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

      // ユーザー自動登録（おへんじ帖からのリクエストのみ）
      if (env.KV && url.searchParams.get('source') === 'ohenji-note') {
        extractAndSaveUrlname(pathParam, env.KV).catch(() => {})
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

// Valid urlname: alphanumeric, underscore, hyphen, dot only
function isValidUrlname(name) {
  return /^[a-zA-Z0-9_.\-]+$/.test(name) && !name.includes('http')
}

// Cleanup: remove invalid entries from KV and rebuild userlist
async function handleCleanup(env) {
  if (!env.KV) {
    return new Response(JSON.stringify({ error: 'No KV' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const list = await env.KV.list({ prefix: 'ohenjicho:users:' })
  const removed = []
  const kept = []

  for (const key of list.keys) {
    const urlname = key.name.replace('ohenjicho:users:', '')
    if (!isValidUrlname(urlname)) {
      await env.KV.delete(key.name)
      removed.push(urlname)
    } else {
      const val = await env.KV.get(key.name, 'json')
      if (val && !val.optOut) {
        kept.push(urlname)
      }
    }
  }

  await env.KV.put('ohenjicho:userlist', JSON.stringify(kept))

  return new Response(JSON.stringify({ removed, kept, removedCount: removed.length, keptCount: kept.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// userlist 差分更新ヘルパー
async function addToUserlist(kv, urlname) {
  const list = await kv.get('ohenjicho:userlist', 'json') || []
  if (!list.includes(urlname)) {
    list.push(urlname)
    await kv.put('ohenjicho:userlist', JSON.stringify(list))
  }
}

async function removeFromUserlist(kv, urlname) {
  const list = await kv.get('ohenjicho:userlist', 'json') || []
  const filtered = list.filter(u => u !== urlname)
  await kv.put('ohenjicho:userlist', JSON.stringify(filtered))
}

// userlist 全件再構築（cleanup用）
async function rebuildUserlist(kv) {
  const list = await kv.list({ prefix: 'ohenjicho:users:' })
  const urlnames = []
  for (const key of list.keys) {
    const val = await kv.get(key.name, 'json')
    if (val && !val.optOut) {
      urlnames.push(val.urlname)
    }
  }
  await kv.put('ohenjicho:userlist', JSON.stringify(urlnames))
}

// urlname を /api/v2/creators/{urlname}/contents のパターンから抽出して KV に保存
async function extractAndSaveUrlname(path, kv) {
  const match = path.match(/\/api\/v2\/creators\/([^/?]+)\/contents/)
  if (!match) return

  const urlname = decodeURIComponent(match[1])
  if (!isValidUrlname(urlname)) return

  const key = `ohenjicho:users:${urlname}`

  const existing = await kv.get(key, 'json')
  if (existing?.optOut === true) return

  await kv.put(key, JSON.stringify({
    urlname,
    registeredAt: existing?.registeredAt || new Date().toISOString(),
    optOut: false,
  }))
  await addToUserlist(kv, urlname)
}

async function handleExportUsers(env, url) {
  if (!env.KV) {
    return new Response('urlname,registeredAt,optOut\n', {
      headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8' },
    })
  }

  const list = await env.KV.list({ prefix: 'ohenjicho:users:' })
  const rows = ['urlname,registeredAt,optOut']
  for (const key of list.keys) {
    const val = await env.KV.get(key.name, 'json')
    if (val) {
      rows.push(`${val.urlname},${val.registeredAt || ''},${val.optOut || false}`)
    }
  }

  const format = url.searchParams.get('format')
  if (format === 'json') {
    const data = []
    for (const key of list.keys) {
      const val = await env.KV.get(key.name, 'json')
      if (val) data.push(val)
    }
    return new Response(JSON.stringify(data, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(rows.join('\n') + '\n', {
    headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8' },
  })
}

async function handleListUsers(env) {
  if (!env.KV) {
    return new Response(JSON.stringify({ userUrlnames: [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // userlist キーから一括取得（なければ旧方式で生成）
  let urlnames = await env.KV.get('ohenjicho:userlist', 'json')
  if (!urlnames) {
    // 初回移行: 個別キーから userlist を生成
    await rebuildUserlist(env.KV)
    urlnames = await env.KV.get('ohenjicho:userlist', 'json') || []
  }

  return new Response(JSON.stringify({ userUrlnames: urlnames }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleOptIn(urlname, env) {
  if (!env.KV) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const key = `ohenjicho:users:${urlname}`
  const existing = await env.KV.get(key, 'json')

  await env.KV.put(key, JSON.stringify({
    urlname,
    registeredAt: existing?.registeredAt || new Date().toISOString(),
    optOut: false,
  }))
  await addToUserlist(env.KV, urlname)

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function handleOptOut(urlname, env) {
  if (!env.KV) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const key = `ohenjicho:users:${urlname}`
  const existing = await env.KV.get(key, 'json')

  await env.KV.put(key, JSON.stringify({
    urlname,
    registeredAt: existing?.registeredAt || new Date().toISOString(),
    optOut: true,
  }))
  await removeFromUserlist(env.KV, urlname)

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// --- コラボ計測 ---

// Sanitize a field for use in a KV key. Allows safe chars; strips others.
function sanitizeKeyPart(s) {
  if (typeof s !== 'string') return ''
  return s.replace(/[^a-zA-Z0-9_\-぀-ヿ一-龯]/g, '_').slice(0, 64)
}

async function handleCollabEvent(request, env) {
  if (!env.KV) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const event = sanitizeKeyPart(body.event)
  const periodId = sanitizeKeyPart(body.periodId)
  const creator = sanitizeKeyPart(body.creator)
  const character = sanitizeKeyPart(body.character)
  const date = sanitizeKeyPart(body.date)

  if (!event || !periodId || !creator) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Append-only log. Each event is a unique KV key so concurrent writes never collide.
  // Key shape: collab:log:{periodId}:{timestamp}-{random}
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const logKey = `collab:log:${periodId}:${id}`
  await env.KV.put(
    logKey,
    JSON.stringify({ event, periodId, creator, character, date })
  )

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Aggregate log entries on read. Returns counts grouped by event/creator/character.
async function handleCollabStats(env, url) {
  if (!env.KV) {
    return new Response(JSON.stringify({ stats: {}, totals: {} }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const periodId = url.searchParams.get('periodId')
  const prefix = periodId
    ? `collab:log:${sanitizeKeyPart(periodId)}:`
    : 'collab:log:'

  // Paginate through all keys, then fetch values in parallel batches.
  const allKeys = []
  let cursor = undefined
  do {
    const page = await env.KV.list({ prefix, cursor })
    allKeys.push(...page.keys.map((k) => k.name))
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  const totals = {} // { period: { event: { creator: { 'all': n, characters: { name: n } } } } }
  const events = {} // flat: { 'event:creator': n, 'event:creator:character': n }

  // Fetch in chunks of 50 to avoid hot loops
  for (let i = 0; i < allKeys.length; i += 50) {
    const chunk = allKeys.slice(i, i + 50)
    const vals = await Promise.all(chunk.map((k) => env.KV.get(k, 'json')))
    for (const v of vals) {
      if (!v) continue
      const { event, creator, character } = v
      const k1 = `${event}:creator:${creator}`
      events[k1] = (events[k1] || 0) + 1
      if (character) {
        const k2 = `${event}:character:${creator}:${character}`
        events[k2] = (events[k2] || 0) + 1
      }
    }
  }

  return new Response(JSON.stringify({ stats: events, total: allKeys.length }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Export raw log entries as CSV.
// Each row: timestamp_ms,jst_iso,event,periodId,creator,character,date
async function handleCollabExport(env, url) {
  if (!env.KV) {
    return new Response('timestamp_ms,jst_iso,event,periodId,creator,character,date\n', {
      headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8' },
    })
  }

  const periodId = url.searchParams.get('periodId')
  const prefix = periodId
    ? `collab:log:${sanitizeKeyPart(periodId)}:`
    : 'collab:log:'

  const allKeys = []
  let cursor = undefined
  do {
    const page = await env.KV.list({ prefix, cursor })
    allKeys.push(...page.keys.map((k) => k.name))
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  // Sort by timestamp asc (chronological order)
  allKeys.sort()

  const rows = ['timestamp_ms,jst_iso,event,periodId,creator,character,date']
  for (let i = 0; i < allKeys.length; i += 50) {
    const chunk = allKeys.slice(i, i + 50)
    const pairs = await Promise.all(
      chunk.map(async (k) => [k, await env.KV.get(k, 'json')])
    )
    for (const [key, v] of pairs) {
      if (!v) continue
      // key shape: collab:log:{periodId}:{ts}-{random}
      const tail = key.split(':').pop() || ''
      const ts = Number(tail.split('-')[0]) || 0
      const jst = ts > 0
        ? new Date(ts + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00')
        : ''
      const csvSafe = (s) => {
        const str = String(s ?? '')
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
      }
      rows.push([
        ts,
        jst,
        csvSafe(v.event),
        csvSafe(v.periodId),
        csvSafe(v.creator),
        csvSafe(v.character),
        csvSafe(v.date),
      ].join(','))
    }
  }

  return new Response(rows.join('\n') + '\n', {
    headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8' },
  })
}

// Delete log entries. With ?periodId=xxx, scope is limited to that period.
// Without it, deletes ALL collab:log:* keys (use with caution).
async function handleCollabReset(env, url) {
  if (!env.KV) {
    return new Response(JSON.stringify({ deleted: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const periodId = url.searchParams.get('periodId')
  const prefix = periodId
    ? `collab:log:${sanitizeKeyPart(periodId)}:`
    : 'collab:log:'

  const list = await env.KV.list({ prefix })
  let deleted = 0
  for (const key of list.keys) {
    await env.KV.delete(key.name)
    deleted++
  }

  return new Response(JSON.stringify({ deleted, prefix }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

