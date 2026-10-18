// 临时诊断接口：/api/music-check
//
// 音乐页的 Notion 查询发生在构建期（getStaticProps），失败时 Vercel 构建日志
// 里才有原因，页面上看不出来。这个接口在请求时重跑一遍同样的查询，把
// 「命中了哪个环境变量 / HTTP 状态 / 错误信息」直接吐成 JSON。
//
// 不泄露任何密钥：只回变量名是否命中、状态码、错误文本和专辑标题（页面上本来就公开）。
// 接线确认无误后可以删掉这个文件。
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0')

  const candidates = [
    'MUSIC_NOTION_TOKEN',
    'NOTION_TOKEN',
    'NOTION_TOKEN_V2',
    'PHOTOGRAPHY_NOTION_TOKEN',
  ]
  const hit = candidates.find((k) => process.env[k])
  const token = hit ? process.env[hit] : ''
  const dbId = process.env.MUSIC_NOTION_DATABASE_ID || ''

  const out = {
    tokenVar: hit || 'MISSING',
    tokenPrefix: token ? token.slice(0, 4) + '…' : '',
    dbId: dbId || 'MISSING',
    notionVersion: '2022-06-28',
    // 只列变量名 + 值长度，不泄露内容：能一眼看出拼写错误、多空格、空值
    envKeys: Object.keys(process.env)
      .filter((k) => /MUSIC|NOTION/i.test(k))
      .sort()
      .map((k) => `${k} (len=${(process.env[k] || '').length})`),
  }

  if (!token || !dbId) {
    return res.status(200).json({ ...out, ok: false, reason: 'missing env' })
  }

  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': out.notionVersion,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100 }),
    })
    const text = await r.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch (e) {}

    if (!r.ok) {
      return res.status(200).json({
        ...out,
        ok: false,
        httpStatus: r.status,
        errorCode: body && body.code,
        errorMessage: body && body.message,
      })
    }

    const rows = (body.results || []).map((p) => {
      const props = p.properties || {}
      const t = props['专辑名']
      const title = t && t.title ? t.title.map((x) => x.plain_text).join('') : ''
      const a = props['歌手']
      const artist =
        a && a.rich_text ? a.rich_text.map((x) => x.plain_text).join('') : ''
      const c = props['分类']
      const cat = c && c.select ? c.select.name : ''
      return { title, artist, cat }
    })

    return res.status(200).json({
      ...out,
      ok: true,
      httpStatus: r.status,
      rowCount: rows.length,
      rows,
    })
  } catch (e) {
    return res.status(200).json({ ...out, ok: false, errorMessage: e.message })
  }
}
