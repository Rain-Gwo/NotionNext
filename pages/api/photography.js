import { getPhotographyPhotos } from '@/lib/photography/notion'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  try {
    return res.status(200).json(await getPhotographyPhotos())
  } catch {
    // No tokens, upstream response bodies or unpublished metadata in public errors.
    console.error(
      '[Photography] Notion read failed. Check photography environment variables, database connection and property schema.'
    )
    return res.status(503).json({ error: '照片暂时无法加载，请稍后重试。' })
  }
}
