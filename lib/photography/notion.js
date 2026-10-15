import { Client, LogLevel } from '@notionhq/client'
import { PHOTO_CATEGORIES, PHOTO_FIELDS as F } from './config'

// Server-only module. Never import this from the gallery component.
const CACHE_MS = 45000
let cache
let pending

function imageUrl(file) {
  const url = file?.file?.url || file?.external?.url
  try {
    return new URL(url).protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

export function normalizePhoto(page) {
  const p = page.properties
  if (page.archived || page.in_trash || p?.[F.published]?.checkbox !== true)
    return null
  const image = p[F.image]?.files?.[0]
  const src = imageUrl(image)
  if (!src) return null
  const label = p[F.category]?.select?.name
  const category =
    Object.keys(PHOTO_CATEGORIES).find(
      key => key === label || PHOTO_CATEGORIES[key] === label
    ) || 'casual'
  return {
    id: page.id,
    src,
    title:
      p[F.title]?.title
        ?.map(text => text.plain_text || text.text?.content || '')
        .join('') || '未命名',
    category
  }
}

export async function queryPhotos(client, databaseId) {
  const photos = []
  let cursor
  let expiresAt = Date.now() + CACHE_MS
  do {
    const result = await client.databases.query({
      database_id: databaseId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
      filter: { property: F.published, checkbox: { equals: true } },
      sorts: [
        { property: F.order, direction: 'ascending' },
        { timestamp: 'created_time', direction: 'descending' }
      ]
    })
    for (const page of result.results) {
      const photo = normalizePhoto(page)
      if (photo) {
        photos.push(photo)
        const expiry = Date.parse(
          page.properties[F.image]?.files?.[0]?.file?.expiry_time
        )
        if (Number.isFinite(expiry))
          expiresAt = Math.min(expiresAt, expiry - 60000)
      }
    }
    cursor = result.has_more ? result.next_cursor : null
    if (result.has_more && !cursor) throw new Error('Invalid Notion pagination')
  } while (cursor)
  return { photos, expiresAt }
}

export async function getPhotographyPhotos() {
  const auth = process.env.PHOTOGRAPHY_NOTION_TOKEN
  const databaseId = process.env.PHOTOGRAPHY_NOTION_DATABASE_ID
  if (!auth || !databaseId) {
    // Demo photos are opt-in in production, never an error fallback for a real library.
    if (
      !auth &&
      !databaseId &&
      (process.env.NODE_ENV === 'development' ||
        process.env.PHOTOGRAPHY_DEMO === 'true')
    ) {
      const demo = await import('./sample.json')
      return { photos: demo.default, source: 'demo' }
    }
    throw new Error('Photography Notion configuration is incomplete')
  }

  const key = `${databaseId}:${auth}`
  if (cache?.key === key && cache.expiresAt > Date.now()) return cache.data
  if (pending?.key === key) return pending.promise

  const promise = (async () => {
    const client = new Client({
      auth,
      timeoutMs: 15000,
      logLevel: LogLevel.ERROR
    })
    const result = await queryPhotos(client, databaseId)
    const data = { photos: result.photos, source: 'notion' }
    cache = { key, data, expiresAt: result.expiresAt }
    return data
  })()
  pending = { key, promise }
  try {
    return await promise
  } finally {
    if (pending?.promise === promise) pending = null
  }
}
