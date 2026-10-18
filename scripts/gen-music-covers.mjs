// Generate self-hosted, WebP-compressed album covers into public/music/covers/.
//
// Why: the page used to load covers cross-origin from y.gtimg.cn (one TLS
// handshake per image). We instead fetch a 300px cover with `Accept: image/webp`
// (QQ CDN negotiates WebP -> ~17KB) and serve it from our own origin.
// `pages/music.js` prefers these local covers and falls back to the remote URL.
//
// This runs as a `prebuild` step, so it must NEVER fail the build:
//   * every network call is wrapped, with a timeout;
//   * albums whose cover file already exists are skipped (a committed manifest
//     makes this a no-op on Vercel — covers are generated at authoring time);
//   * any unexpected error is logged and exits 0.
//
// Sources (in priority order):
//   1. public/music/enrich-cache.json  (title\0artist -> { cover, ... })
//   2. Notion, if MUSIC_NOTION_TOKEN / NOTION_TOKEN_V2 / NOTION_TOKEN is set
//   3. public/music/albums.json
//
// Run locally after adding albums:  node scripts/gen-music-covers.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const COVERS_DIR = path.join(ROOT, 'public/music/covers')
const MANIFEST = path.join(ROOT, 'public/music/covers_manifest.json')
const ENRICH_CACHE = path.join(ROOT, 'public/music/enrich-cache.json')
const ALBUMS_JSON = path.join(ROOT, 'public/music/albums.json')

const QQ_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function fetchWithTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// Last-resort lookup: search QQ Music for the album cover id.
async function qqAlbumMid(title, artist) {
  try {
    const term = encodeURIComponent(`${title} ${artist}`)
    const r = await fetchWithTimeout(
      `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?aggr=1&cr=1&lossless=0&flag_qc=0&p=1&n=5&w=${term}&format=json`,
      { headers: { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/' } }
    )
    if (!r.ok) return null
    const text = await r.text()
    if (!text) return null
    const d = JSON.parse(text)
    const albums = d?.data?.album?.list || []
    const songs = d?.data?.song?.list || []
    const pick = albums[0] || songs[0]
    const mid = pick?.albummid
    return mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : null
  } catch {
    return null
  }
}

async function fetchImage(url) {
  if (!url) return null
  try {
    const r = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': QQ_UA,
        Referer: 'https://y.qq.com/',
        Accept: 'image/webp,image/*,*/*'
      }
    })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    // A valid image is > 1KB; anything smaller is an error page / empty body.
    return buf.length > 1024 ? buf : null
  } catch {
    return null
  }
}

// 1) enrich cache: the authoritative, pre-computed list (no network needed).
function albumsFromEnrichCache() {
  const cache = readJSON(ENRICH_CACHE, null)
  if (!cache || typeof cache !== 'object') return null
  const out = []
  for (const key of Object.keys(cache)) {
    const [title, artist] = key.split('\u0000')
    const cover = cache[key]?.cover
    if (title && artist) out.push({ title, artist, cover })
  }
  return out.length ? out : null
}

// 2) Notion (same token chain as pages/music.js — there is no NOTION_TOKEN here).
async function albumsFromNotion() {
  const token =
    process.env.MUSIC_NOTION_TOKEN ||
    process.env.NOTION_TOKEN ||
    process.env.NOTION_TOKEN_V2 ||
    process.env.PHOTOGRAPHY_NOTION_TOKEN ||
    ''
  const dbId = process.env.MUSIC_NOTION_DATABASE_ID || ''
  if (!token || !dbId) return null
  try {
    const r = await fetchWithTimeout(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 100 })
      }
    )
    if (!r.ok) return null
    const data = JSON.parse(await r.text())
    return (data.results || [])
      .map((row) => {
        const p = row.properties || {}
        const title = (p['专辑名']?.title || [])
          .map((x) => x.plain_text || '')
          .join('')
          .trim()
        const artist = (p['歌手']?.rich_text || [])
          .map((x) => x.plain_text || '')
          .join('')
          .trim()
        return title && artist ? { title, artist } : null
      })
      .filter(Boolean)
  } catch {
    return null
  }
}

// 3) Local fallback list.
function albumsFromJSON() {
  const list = readJSON(ALBUMS_JSON, null)
  if (!Array.isArray(list) || !list.length) return null
  return list
    .map((x) => (x && x.title && x.artist ? { title: x.title, artist: x.artist } : null))
    .filter(Boolean)
}

async function main() {
  const albums =
    albumsFromEnrichCache() ||
    (await albumsFromNotion()) ||
    albumsFromJSON() ||
    []

  if (!albums.length) {
    console.log('[gen-covers] no albums found, skipping')
    return
  }

  const manifest = readJSON(MANIFEST, {}) || {}
  fs.mkdirSync(COVERS_DIR, { recursive: true })

  let made = 0
  let skipped = 0
  let failed = 0

  for (const a of albums) {
    const key = `${a.title}__${a.artist}`
    const slug = slugify(`${a.title}-${a.artist}`)
    const rel = `/music/covers/${slug}.webp`
    const out = path.join(COVERS_DIR, `${slug}.webp`)

    // Idempotent: already generated and committed -> nothing to do.
    if (manifest[key] && fs.existsSync(out)) {
      skipped++
      continue
    }

    const url = a.cover || (await qqAlbumMid(a.title, a.artist))
    const buf = await fetchImage(url)
    if (!buf) {
      failed++
      console.log(`[gen-covers] skip (no image): ${a.title} / ${a.artist}`)
      continue
    }
    fs.writeFileSync(out, buf)
    manifest[key] = rel
    made++
    console.log(`[gen-covers] ok ${(buf.length / 1024).toFixed(0)}KB -> ${rel}`)
  }

  // Merge with whatever was already there, keep it stable and sorted.
  const sorted = {}
  for (const k of Object.keys(manifest).sort()) sorted[k] = manifest[k]
  fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n')

  console.log(
    `[gen-covers] done: ${made} new, ${skipped} already present, ${failed} failed (manifest ${Object.keys(sorted).length})`
  )
}

main()
  .catch((e) => {
    // Never break the deploy because of cover generation.
    console.error('[gen-covers] non-fatal error:', e && e.message)
  })
  .finally(() => process.exit(0))
