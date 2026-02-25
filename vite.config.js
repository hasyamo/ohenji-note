import { defineConfig } from 'vite'
import { writeFileSync } from 'fs'
import { resolve } from 'path'

export default defineConfig({
  base: '/ohenji-note/',
  plugins: [
    {
      name: 'generate-sw',
      closeBundle() {
        const version = Date.now().toString()
        const sw = `const CACHE_NAME = 'ncm-${version}'

// Install: skip waiting
self.addEventListener('install', () => {
  self.skipWaiting()
})

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)

  // API requests: network only
  if (url.hostname.includes('workers.dev')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'オフラインです' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    )
    return
  }

  // App shell: network first, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone))
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
`
        writeFileSync(resolve('dist', 'sw.js'), sw)
      },
    },
  ],
})
