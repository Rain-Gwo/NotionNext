#!/usr/bin/env node
// Pre-compute album metadata (cover / tracklist / direct links) ONCE, at authoring
// time, and commit the result as `public/music/enrich-cache.json`.
//
// Why: enriching at build time means ~600 upstream requests (QQ Music + Netease)
// on every deploy. With 60+ albums that pushed the Vercel build past 16 minutes
// and it eventually failed. With a warm cache `getStaticProps` does zero network
// work — the build is fast and cannot fail because of an upstream hiccup.
//
// Usage:
//   node scripts/music-cache.mjs scripts/music-cache-source.json
//
// `music-cache-source.json` is a snapshot of the Notion rows:
//   [{ "title": "丑奴儿", "artist": "草东没有派对" }, ...]
// Export it from Notion (or copy it from the Notion MCP query) whenever you add
// albums. Entries missing from the cache are still enriched at build time, so a
// forgotten refresh degrades gracefully instead of breaking.
//
// IMPORTANT: the enrichment logic below mirrors `pages/music.js` (QQ Music
// primary, MusicBrainz + iTunes fallback, Netease per-track links). If you change
// one, change the other.
import fs from 'node:fs'
import path from 'node:path'

const UA = 'guohaobo-music/1.0 (https://guohaobo.com; contact@guohaobo.com)'
const QQ_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const OUT = path.join(process.cwd(), 'public/music/enrich-cache.json')
const SRC = process.argv[2] || path.join(process.cwd(), 'scripts/music-cache-source.json')

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '0:00'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function fetchJSON(url, headers = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json()
  } catch (e) {
    return null
  } finally {
    clearTimeout(t)
  }
}

async function mapLimit(items, limit, fn) {
  const list = items || []
  const out = new Array(list.length)
  let cursor = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, list.length)) },
    async () => {
      while (cursor < list.length) {
        const i = cursor++
        out[i] = await fn(list[i], i)
      }
    }
  )
  await Promise.all(workers)
  return out
}

// ---------- QQ Music (primary) ----------
async function qqSearchAlbum(title, artist) {
  const term = encodeURIComponent(`${title} ${artist}`)
  const d = await fetchJSON(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?aggr=1&cr=1&lossless=0&flag_qc=0&p=1&n=5&w=${term}&format=json`,
    { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/' }
  )
  const albums = d?.data?.album?.list || []
  const songs = d?.data?.song?.list || []
  const pick = albums[0] || songs[0]
  if (!pick || !pick.albummid) return null
  return { albummid: pick.albummid, name: pick.albumname }
}

async function qqAlbumDetail(albummid) {
  const d = await fetchJSON(
    `https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?type=1&json=1&albummid=${albummid}&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0&hostUin=0&notice=0`,
    { 'User-Agent': QQ_UA, Referer: 'https://y.qq.com/' }
  )
  const data = d?.data
  if (!data) return null
  const tracks = (data.list || []).map((s, i) => ({
    id: `${albummid}-t${i + 1}`,
    title: s.songname || '',
    artist: (s.singer || []).map((x) => x.name).join('/') || '',
    duration: fmtDuration((s.interval || 0) * 1000),
    explicit: false,
    links: s.songmid
      ? { qq: `https://y.qq.com/n/ryqq/songDetail/${s.songmid}` }
      : {}
  }))
  if (!tracks.length) return null
  return {
    cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`,
    tracks,
    year: (data.aDate || '').slice(0, 4)
  }
}

// ---------- Fallbacks ----------
async function musicbrainzEnrich(title, artist) {
  const q = encodeURIComponent(`release:"${title}" AND artist:"${artist}"`)
  const s = await fetchJSON(
    `https://musicbrainz.org/ws/2/release/?query=${q}&fmt=json&limit=5`,
    { 'User-Agent': UA }
  )
  const rel = s?.releases?.[0]
  if (!rel?.id) return null
  const d = await fetchJSON(
    `https://musicbrainz.org/ws/2/release/${rel.id}?inc=recordings+media&fmt=json`,
    { 'User-Agent': UA }
  )
  if (!d) return null
  const tracks = []
  let n = 0
  for (const medium of d.media || []) {
    for (const tr of medium.tracks || []) {
      n++
      tracks.push({
        id: `${rel.id}-t${n}`,
        title: tr.title,
        artist,
        duration: fmtDuration(tr.length),
        explicit: false,
        links: {}
      })
    }
  }
  if (!tracks.length) return null
  return {
    cover: `https://coverartarchive.org/release/${rel.id}/front`,
    tracks,
    year: (rel.date || '').slice(0, 4)
  }
}

async function itunesEnrich(title, artist) {
  const term = encodeURIComponent(`${title} ${artist}`)
  const d = await fetchJSON(
    `https://itunes.apple.com/search?term=${term}&entity=album&limit=5`,
    { 'User-Agent': UA }
  )
  const c = d?.results?.[0]
  if (!c) return null
  let tracks = []
  if (c.collectionId) {
    const ld = await fetchJSON(
      `https://itunes.apple.com/lookup?id=${c.collectionId}&entity=song`,
      { 'User-Agent': UA }
    )
    tracks = (ld?.results || [])
      .filter((r) => r.wrapperType === 'track')
      .map((r, i) => ({
        id: `${c.collectionId}-t${i + 1}`,
        title: r.trackName,
        artist: r.artistName,
        duration: fmtDuration(r.trackTimeMillis),
        explicit: r.trackExplicitness === 'explicit',
        links: {}
      }))
  }
  if (!tracks.length) return null
  return {
    cover: (c.artworkUrl100 || '').replace('100x100', '600x600'),
    tracks,
    year: String(c.releaseDate || '').slice(0, 4)
  }
}

// ---------- Netease per-track direct links ----------
const _neteaseCache = new Map()
async function neteaseSongId(title, artist) {
  const key = `${title}\u0000${artist}`
  if (_neteaseCache.has(key)) return _neteaseCache.get(key)
  const q = encodeURIComponent(`${title} ${artist}`)
  const d = await fetchJSON(
    `https://music.163.com/api/search/get?type=1&s=${q}&limit=1`,
    { 'User-Agent': QQ_UA, Referer: 'https://music.163.com/' }
  )
  const id = d?.result?.songs?.[0]?.id || null
  _neteaseCache.set(key, id)
  return id
}

async function enrichOne(item) {
  let info = await qqEnrich(item.title, item.artist)
  if (!info) info = await musicbrainzEnrich(item.title, item.artist)
  if (!info) info = await itunesEnrich(item.title, item.artist)
  if (!info) return null

  await mapLimit(info.tracks, 3, async (t) => {
    if (t.links && t.links.netease) return
    const nid = await neteaseSongId(t.title, t.artist)
    if (nid) {
      t.links = t.links || {}
      t.links.netease = `https://music.163.com/song/${nid}`
    }
  })
  return info
}

async function qqEnrich(title, artist) {
  const s = await qqSearchAlbum(title, artist)
  if (!s || !s.albummid) return null
  return qqAlbumDetail(s.albummid)
}

// ---------- main ----------
const source = JSON.parse(fs.readFileSync(SRC, 'utf8'))
const list = source.filter((x) => x && x.title && x.artist)
console.log(`[music-cache] ${list.length} albums from ${path.basename(SRC)}`)

let done = 0
const results = await mapLimit(list, 4, async (item) => {
  const info = await enrichOne(item)
  done++
  if (done % 10 === 0) console.log(`  ... ${done}/${list.length}`)
  if (!info) {
    console.log(`  MISS ${item.title} / ${item.artist}`)
    return null
  }
  return { key: `${item.title}\u0000${item.artist}`, info }
})

const cache = {}
for (const r of results) if (r) cache[r.key] = r.info
fs.writeFileSync(OUT, JSON.stringify(cache, null, 0) + '\n')

const missing = results.filter((r) => !r).length
console.log(
  `[music-cache] wrote ${Object.keys(cache).length} entries -> ${OUT} (miss ${missing})`
)
