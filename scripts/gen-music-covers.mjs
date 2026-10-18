// Generate self-hosted, WebP-compressed album covers into public/music/covers/.
//
// Why: the live page previously loaded covers cross-origin from y.gtimg.cn
// (one TLS handshake per image) at 500px JPEG (~77KB). We instead fetch a
// 300px cover with `Accept: image/webp` (QQ CDN negotiates WebP -> ~17KB) and
// serve it from our own origin, eliminating cross-origin latency and shrinking
// the payload ~4.5x. `pages/music.js` prefers these local covers and falls back
// to the remote URL only when a cover wasn't pre-generated.
//
// Sources (in priority order):
//   1. If MUSIC_NOTION_DATABASE_ID + NOTION_TOKEN are set -> query the Notion DB.
//   2. Otherwise -> read public/music/albums.json.
//
// Run as a prebuild step (or locally) so covers are committed / present at build.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const COVERS_DIR = path.join(ROOT, 'public/music/covers')
const MANIFEST = path.join(ROOT, 'public/music/covers_manifest.json')

const QQ_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function coverKey(title, artist) {
  return `${title}__${artist}`
}

async function qqAlbumMid(title, artist) {
  const term = encodeURIComponent(`${title} ${artist}`)
  const d = await fetch(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?aggr=1&cr=1&lossless=0&flag_qc=0&p=1&n=5&w=${term}&format=json`,
    { headers: { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/' } }
  ).then(r => r.json())
  const albums = d?.data?.album?.list || []
  const songs = d?.data?.song?.list || []
  const pick = albums[0] || songs[0]
  return pick?.albummid || null
}

async function fetchWebp(albummid) {
  const url = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`
  const r = await fetch(url, {
    headers: { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/', Accept: 'image/webp,*/*' }
  })
  if (!r.ok) return null
  const buf = Buffer.from(await r.arrayBuffer())
  if (!buf.length) return null
  return buf
}

async function getNotionAlbums() {
  const token = process.env.NOTION_TOKEN
  const dbId = process.env.MUSIC_NOTION_DATABASE_ID
  if (!token || !dbId) return null
  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page_size: 100 })
  })
  if (!res.ok) throw new Error(`Notion query failed: ${res.status}`)
  const data = await res.json()
  return data.results
    .map(r => {
      const p = r.properties || {}
      const title = p['专辑名']?.title?.map(x => x.plain_text || '').join('')?.trim()
      const artist = p['歌手']?.rich_text?.map(x => x.plain_text || '').join('')?.trim()
      return title && artist ? { title, artist } : null
    })
    .filter(Boolean)
}

async function main() {
  let albums = await getNotionAlbums().catch(() => null)
  if (!albums || albums.length === 0) {
    try {
      albums = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'public/music/albums.json'), 'utf8')
      )
    } catch {
      albums = []
    }
  }
  if (!albums.length) {
    console.log('[gen-covers] no albums found, skipping')
    return
  }

  fs.mkdirSync(COVERS_DIR, { recursive: true })
  const manifest = {}

  for (const a of albums) {
    const key = coverKey(a.title, a.artist)
    const slug = slugify(`${a.title}-${a.artist}`)
    const out = path.join(COVERS_DIR, `${slug}.webp`)
    const mid = await qqAlbumMid(a.title, a.artist)
    if (!mid) {
      console.log(`[gen-covers] skip (no QQ match): ${a.title} / ${a.artist}`)
      continue
    }
    const buf = await fetchWebp(mid)
    if (!buf) {
      console.log(`[gen-covers] skip (download failed): ${a.title} / ${a.artist}`)
      continue
    }
    fs.writeFileSync(out, buf)
    manifest[key] = `/music/covers/${slug}.webp`
    console.log(`[gen-covers] ok ${buf.length}B -> ${manifest[key]}  (${a.title})`)
  }

  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2))
  console.log(`[gen-covers] wrote manifest: ${Object.keys(manifest).length} covers`)
}

main().catch(e => {
  console.error('[gen-covers] error', e)
  process.exit(1)
})
