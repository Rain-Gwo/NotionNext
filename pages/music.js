// Music (Oliver Guo) — immersive standalone page, same pattern as /about.
//
// The page markup lives in `public/music/index.html` (HTML + Tailwind classes).
// Album data is NOT hardcoded: `getStaticProps` reads a Notion "音乐" database
// (you only maintain 专辑名 + 歌手 + 分类), then enriches each row with cover
// art + full tracklist. Primary source is **QQ Music** (domestic, unencrypted,
// covers served from Tencent CDN — fast in China, accurate for CN/EN catalogs),
// with MusicBrainz (+ Cover Art Archive) and the iTunes Search API as fallbacks.
// The enriched JSON is injected as `window.__ALBUMS__` and consumed by
// `public/music/script.js`.
//
// Revalidated hourly (ISR): add an album in Notion and it shows up within the
// revalidation window (or trigger an on-demand revalidation).
import fs from 'fs'
import path from 'path'
import { useEffect, useState } from 'react'
import Head from 'next/head'
import Script from 'next/script'

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap'

const FAVICON_HREF =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23000'/%3E%3Ctext x='16' y='22' font-size='16' text-anchor='middle' fill='%23ff2d55' font-family='Georgia,serif'%3E♪%3C/text%3E%3C/svg%3E"

const UA = 'guohaobo-music/1.0 (https://guohaobo.com; contact@guohaobo.com)'
// QQ Music's endpoints expect a browser-like UA / Referer.
const QQ_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const FALLBACK_COVER =
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80'

function readSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8')
  } catch (e) {
    return ''
  }
}

function pick(html, re) {
  const m = html.match(re)
  return m ? m[1] : ''
}

// Minimal HTML escaper so user-supplied album titles can't break the markup
// (used both for the server-pre-rendered cards and the client template).
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function firstProp(props, candidates, kind) {
  for (const key of candidates) {
    const p = props[key]
    if (!p) continue
    if (kind === 'title' && Array.isArray(p.title)) {
      const t = p.title.map(x => x.plain_text || '').join('').trim()
      if (t) return t
    }
    if (kind === 'text' && Array.isArray(p.rich_text)) {
      const t = p.rich_text.map(x => x.plain_text || '').join('').trim()
      if (t) return t
    }
    if (kind === 'select' && p.select && p.select.name) return p.select.name
  }
  return ''
}

// ---------- Notion ----------
// This fork has no plain `NOTION_TOKEN`: the blog itself authenticates with
// NOTION_TOKEN_V2, and the photography gallery with PHOTOGRAPHY_NOTION_TOKEN.
// Accept any of them (plus a dedicated MUSIC_NOTION_TOKEN) so wiring the music
// library never depends on guessing one exact variable name. A token that lacks
// access to the library simply 404s and we fall back to albums.json.
function notionToken() {
  return (
    process.env.MUSIC_NOTION_TOKEN ||
    process.env.NOTION_TOKEN ||
    process.env.NOTION_TOKEN_V2 ||
    process.env.PHOTOGRAPHY_NOTION_TOKEN ||
    ''
  )
}

async function getNotionAlbums() {
  const token = notionToken()
  const dbId = process.env.MUSIC_NOTION_DATABASE_ID
  if (!token || !dbId) {
    console.warn(
      `[music] Notion skipped (token: ${token ? 'ok' : 'MISSING'}, dbId: ${
        dbId || 'MISSING'
      }) — using albums.json`
    )
    return null
  }

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
      const props = r.properties || {}
      const title = firstProp(props, ['专辑名', 'Album', 'Name', '标题'], 'title')
      const artist = firstProp(props, ['歌手', 'Artist', '艺人'], 'text')
      const catRaw = firstProp(props, ['分类', 'Category', '类型'], 'select')
      const category = catRaw.includes('收藏') ? 'favorites' : 'recent'
      return title && artist ? { title, artist, category } : null
    })
    .filter(Boolean)
}

// ---------- Enrichment (MusicBrainz + iTunes) ----------
function fmtDuration(ms) {
  if (!ms || ms <= 0) return '0:00'
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

async function fetchJSON(url, headers = {}) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
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

// Run async tasks with bounded concurrency, preserving input order.
// Used for album enrichment and per-track Netease lookups: sequential awaits
// made the build scale linearly (63 albums ≈ 16 min) and it eventually failed.
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
        explicit: false
      })
    }
  }
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
      .filter(r => r.wrapperType === 'track')
      .map((r, i) => ({
        id: `${c.collectionId}-t${i + 1}`,
        title: r.trackName,
        artist: r.artistName,
        duration: fmtDuration(r.trackTimeMillis),
        explicit: r.trackExplicitness === 'explicit'
      }))
  }
  return {
    cover: (c.artworkUrl100 || '').replace('100x100', '600x600'),
    tracks,
    year: String(c.releaseDate || '').slice(0, 4)
  }
}

// ---------- Enrichment: QQ Music (primary, domestic) ----------
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
  const list = data.list || []
  const tracks = list.map((s, i) => ({
    id: `${albummid}-t${i + 1}`,
    title: s.songname || '',
    artist: (s.singer || []).map(x => x.name).join('/') || '',
    duration: fmtDuration((s.interval || 0) * 1000),
    explicit: false,
    // Direct song link to QQ Music's web player (domestic, fast).
    links: s.songmid
      ? { qq: `https://y.qq.com/n/ryqq/songDetail/${s.songmid}` }
      : {}
  }))
  if (!tracks.length) return null
  return {
    // 300px + browser's Accept:image/webp -> ~17KB WebP from Tencent CDN.
    cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`,
    tracks,
    year: (data.aDate || '').slice(0, 4)
  }
}

async function qqEnrich(title, artist) {
  const search = await qqSearchAlbum(title, artist)
  if (!search || !search.albummid) return null
  return qqAlbumDetail(search.albummid)
}

// Netease Cloud Music: unencrypted search endpoint returns the song id, which
// we turn into a direct https://music.163.com/song/{id} link. Cached per
// (title|artist) so a build reuses results instead of re-querying every track.
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

// Prefer self-hosted, WebP-compressed covers generated at build time
// (scripts/gen-music-covers.mjs -> public/music/covers_manifest.json). Falls
// back to the remote Tencent-CDN URL only when a cover wasn't pre-generated.
const COVER_MANIFEST_PATH = path.join(
  process.cwd(),
  'public/music/covers_manifest.json'
)
let _coverManifest = null
function coverManifest() {
  if (_coverManifest === null) {
    try {
      _coverManifest = JSON.parse(fs.readFileSync(COVER_MANIFEST_PATH, 'utf8'))
    } catch (e) {
      _coverManifest = {}
    }
  }
  return _coverManifest
}
function localCover(title, artist) {
  return coverManifest()[`${title}__${artist}`] || null
}

// ---------- Pre-computed album metadata ----------
// `public/music/enrich-cache.json` is generated offline (at authoring time) by
// `node scripts/music-cache.mjs`, and committed. It holds cover / tracklist /
// direct links for every album, so `getStaticProps` performs ZERO upstream
// requests: the 60-album library used to take ~16 minutes to enrich on every
// deploy and the Vercel build failed at the end of it.
// Cache key is `title\u0000artist` — the same pair used for Notion rows.
const ENRICH_CACHE_PATH = path.join(
  process.cwd(),
  'public/music/enrich-cache.json'
)
let _enrichCache = null
function enrichCache() {
  if (_enrichCache === null) {
    try {
      _enrichCache = JSON.parse(fs.readFileSync(ENRICH_CACHE_PATH, 'utf8'))
    } catch (e) {
      _enrichCache = {}
    }
  }
  return _enrichCache
}
function cachedInfo(title, artist) {
  const hit = enrichCache()[`${title}\u0000${artist}`]
  return hit && hit.tracks && hit.tracks.length ? hit : null
}

async function enrich(a, index) {
  // Cache first: `public/music/enrich-cache.json` is generated offline by
  // `node scripts/music-cache.mjs`, so a deploy reads a static file instead of
  // hammering QQ Music / Netease for every album. Only rows that are NOT in the
  // cache (a newly added Notion album) go to the network.
  const cached = cachedInfo(a.title, a.artist)

  // Primary: QQ Music (domestic, unencrypted, Tencent-CDN covers).
  let info = cached || (await qqEnrich(a.title, a.artist))
  // Fallback 1: MusicBrainz + Cover Art Archive.
  if (!info || !info.tracks || info.tracks.length === 0) {
    info = await musicbrainzEnrich(a.title, a.artist)
  }
  // Fallback 2: iTunes Search API.
  if (!info || !info.tracks || info.tracks.length === 0) {
    info = await itunesEnrich(a.title, a.artist)
  }
  if (!info) info = { cover: '', tracks: [], year: '' }

  // Use the self-hosted WebP cover when available (faster, no cross-origin).
  const local = localCover(a.title, a.artist)
  if (local) info.cover = local

  const hasRealTracks = info.tracks && info.tracks.length > 0
  const tracks = hasRealTracks
    ? info.tracks.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        duration: t.duration,
        explicit: !!t.explicit,
        links: t.links || {}
      }))
    : [
        {
          id: `t1`,
          title: `${a.title} - Prelude`,
          artist: a.artist,
          duration: '0:00',
          explicit: false,
          links: {}
        }
      ]

  // Attach Netease direct links only for real tracks (skip placeholder).
  // Skipped entirely on a cache hit — the cached tracks already carry them.
  if (hasRealTracks && !cached) {
    await mapLimit(tracks, 3, async (t) => {
      if (t.links.netease) return
      const nid = await neteaseSongId(t.title, t.artist)
      if (nid) t.links.netease = `https://music.163.com/song/${nid}`
    })
  }

  return {
    id: `album-${index}-${Date.now()}`,
    title: a.title,
    artist: a.artist,
    genreYear: `${a.category === 'favorites' ? '收藏' : '最近'} · ${
      info.year || '2026'
    }年`,
    description: `由 ${a.artist} 打造的《${a.title}》。`,
    cover: info.cover || FALLBACK_COVER,
    explicit: false,
    category: a.category,
    tracks
  }
}

// Server-side album card matching the client template (script.js). Pre-rendered
// into the grid markup at build time so the first paint already has content and
// there is no empty-grid flash before script.js runs.
function renderAlbumCard(album) {
  const cover = esc(album.cover || '')
  const title = esc(album.title || '')
  const artist = esc(album.artist || '')
  const exp = album.explicit
    ? '<span class="explicit-badge flex-shrink-0">E</span>'
    : ''
  return `
        <div onclick="openAlbumDetail('${esc(album.id)}')" class="album-card cursor-pointer group flex flex-col space-y-2">
            <div class="album-card-img-wrapper aspect-square relative shadow-lg">
                <img src="${cover}" alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500" loading="lazy" decoding="async" sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 16vw">
            </div>
            <div class="min-w-0">
                <div class="flex items-center space-x-1">
                    <h3 class="font-bold text-xs sm:text-sm theme-text-primary truncate group-hover:text-rose-500 transition">${title}</h3>
                    ${exp}
                </div>
                <p class="text-[11px] sm:text-xs theme-text-secondary truncate mt-0.5">${artist}</p>
            </div>
        </div>`
}

// Inject pre-rendered cards into an empty grid container in the page markup.
// Kept in sync with EMPTY_NOTE / gridHtml() in public/music/script.js.
const EMPTY_NOTE =
  '<p style="grid-column:1/-1;padding:28px 0;font-size:14px;line-height:1.7;color:rgba(255,255,255,.42)">这个分区还是空的 —— 在 Notion「音乐」库里加一行，分类选「最近在听」或「我的收藏」，一小时内自动同步。</p>'

function fillGrid(body, gridId, albums) {
  const list = (albums || []).slice(0, 12)
  const html = list.length ? list.map(renderAlbumCard).join('') : EMPTY_NOTE
  const re = new RegExp(
    `(<div[^>]*id="${gridId}"[^>]*>)[\\s\\S]*?(</div>)`,
    'i'
  )
  return body.replace(re, `$1\n${html}\n`)
}

async function buildAlbums() {
  let raw = null
  try {
    raw = await getNotionAlbums()
  } catch (e) {
    // 接线常见故障：库没分享给集成（404）、token 失效（401）、env 写错。
    // 这种情况下绝不能把整页渲染成空 —— 退回本地 albums.json，
    // 页面照旧有内容，同时日志里能看到真正的原因。
    console.error('[music] Notion query failed, using albums.json:', e.message)
  }

  if (!raw || raw.length === 0) {
    // Fallback: local editable list, handy before Notion is wired up.
    try {
      const f = path.join(process.cwd(), 'public/music/albums.json')
      const list = JSON.parse(fs.readFileSync(f, 'utf8'))
      raw = (list || []).map(x => ({
        title: x.title,
        artist: x.artist,
        category: x.category || 'recent'
      }))
    } catch (e) {
      raw = []
    }
  }

  if (!raw || raw.length === 0) return []

  // Bounded concurrency instead of a serial for-await: a 60+ album library took
  // ~16 minutes when every album waited for the previous one, and the Vercel
  // build failed at the end of it. A pool of 4 keeps the whole enrichment under
  // a minute while staying polite to QQ / MusicBrainz / Netease.
  const out = await mapLimit(raw, 4, async (item, i) => {
    try {
      return await enrich(item, i)
    } catch (e) {
      console.error('[music] enrich failed for', item, e)
      return null
    }
  })
  return out.filter(Boolean)
}

export async function getStaticProps() {
  const html = readSafe(path.join(process.cwd(), 'public/music/index.html'))
  const title =
    pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || 'Music — Oliver Guo'
  const desc =
    pick(html, /<meta name="description" content="([^"]*)"/i) ||
    '我喜欢的专辑与歌曲'
  const body = pick(html, /<body[^>]*>([\s\S]*?)<\/body>/i)
  const css = readSafe(path.join(process.cwd(), 'public/music/styles.css'))
  // Precompiled Tailwind (tailwind.music.config.js -> public/music/tw.css),
  // inlined into <head> so the very first paint is fully styled. This removes
  // the Play-CDN runtime JIT entirely — no FOUC / flash on any device.
  const twCss = readSafe(path.join(process.cwd(), 'public/music/tw.css'))

  let albums = []
  try {
    albums = await buildAlbums()
  } catch (e) {
    console.error('[music] build failed', e)
  }

  // Pre-render album cards into the grids so the first paint already has
  // content — eliminates the empty-grid flash before script.js runs.
  let filledBody = body
  if (albums && albums.length) {
    const recent = albums.filter(a => a.category === 'recent')
    const fav = albums.filter(a => a.category === 'favorites')
    filledBody = fillGrid(filledBody, 'recentlyPlayedGrid', recent)
    filledBody = fillGrid(filledBody, 'favoritesGrid', fav)
  }
  // Strip the standalone <script src="script.js"> — Next loads it via
  // <Script> below. Without this it would execute twice.
  filledBody = filledBody.replace(
    /<script src="script\.js"[^>]*><\/script>/i,
    ''
  )

  // Escape `<` so the JSON can never break out of the <script> tag.
  const albumsJson = JSON.stringify(albums || []).replace(/</g, '\\u003c')

  return {
    props: { title, desc, body: filledBody, css, twCss, albumsJson },
    revalidate: 3600
  }
}

export default function Music({ title, desc, body, css, twCss, albumsJson }) {
  // Fade in from black on mount. `ready` starts false so the server-rendered
  // HTML carries opacity:0 — the first painted frame is guaranteed black (the
  // <html> background is pre-painted black on navigation), then we flip to
  // opacity:1 on the next frame so the transition runs 0→1. This avoids the
  // CSS-animation "first frame painted before the animation starts" blip.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name='description' content={desc} />
        <link rel='icon' href={FAVICON_HREF} />
        <link rel='canonical' href='https://www.guohaobo.com/music/' />
        <meta property='og:type' content='website' />
        <meta property='og:title' content={title} />
        <meta property='og:description' content={desc} />
        <meta property='og:url' content='https://www.guohaobo.com/music/' />
        <meta name='twitter:card' content='summary_large_image' />
        {/* Critical paint: keep the page dark on the very first frame. */}
        <style
          dangerouslySetInnerHTML={{
            __html: 'html,body{background:#000000;color:#f5f5f7}'
          }}
        />
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link
          rel='preconnect'
          href='https://fonts.gstatic.com'
          crossOrigin='anonymous'
        />
        <link href={FONT_HREF} rel='stylesheet' />
        <link
          rel='stylesheet'
          href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
        />
        {/* Tailwind utilities, precompiled at build time and inlined — replaces
            the runtime Play CDN, so there is no unstyled first paint. */}
        <style dangerouslySetInnerHTML={{ __html: twCss }} />
        {/* Custom page styles (inlined) */}
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {/* 注入构建期补全好的专辑数据 */}
        <script
          dangerouslySetInnerHTML={{ __html: `window.__ALBUMS__ = ${albumsJson};` }}
        />
      </Head>

      <div
        id='music-root'
        className='music-page'
        style={{
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.12s ease-out'
        }}
        dangerouslySetInnerHTML={{ __html: body }}
      />

      <Script src='/music/script.js?v=4' strategy='afterInteractive' />
    </>
  )
}
