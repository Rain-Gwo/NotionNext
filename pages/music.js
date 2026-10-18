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
    explicit: false
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

async function enrich(a, index) {
  // Primary: QQ Music (domestic, unencrypted, Tencent-CDN covers).
  let info = await qqEnrich(a.title, a.artist)
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

  const tracks =
    info.tracks && info.tracks.length
      ? info.tracks
      : [
          {
            id: `t1`,
            title: `${a.title} - Prelude`,
            artist: a.artist,
            duration: '0:00',
            explicit: false
          }
        ]

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

async function buildAlbums() {
  let raw = await getNotionAlbums()

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

  const out = []
  for (let i = 0; i < raw.length; i++) {
    try {
      out.push(await enrich(raw[i], i))
    } catch (e) {
      console.error('[music] enrich failed for', raw[i], e)
    }
  }
  return out
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

  let albums = []
  try {
    albums = await buildAlbums()
  } catch (e) {
    console.error('[music] build failed', e)
  }

  // Escape `<` so the JSON can never break out of the <script> tag.
  const albumsJson = JSON.stringify(albums || []).replace(/</g, '\\u003c')

  return {
    props: { title, desc, body, css, albumsJson },
    revalidate: 3600
  }
}

export default function Music({ title, desc, body, css, albumsJson }) {
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
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link
          rel='preconnect'
          href='https://fonts.gstatic.com'
          crossOrigin='anonymous'
        />
        <link href={FONT_HREF} rel='stylesheet' />
        <script src='https://cdn.tailwindcss.com' />
        <link
          rel='stylesheet'
          href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
        />
        {/* 内联样式：消除客户端跳转时的 FOUC */}
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {/* 注入构建期补全好的专辑数据 */}
        <script
          dangerouslySetInnerHTML={{ __html: `window.__ALBUMS__ = ${albumsJson};` }}
        />
      </Head>

      <div
        id='music-root'
        className='music-page'
        dangerouslySetInnerHTML={{ __html: body }}
      />

      <Script src='/music/script.js' strategy='afterInteractive' />
    </>
  )
}
