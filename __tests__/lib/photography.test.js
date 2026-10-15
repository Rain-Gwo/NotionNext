/** @jest-environment node */
import {
  normalizePhoto,
  queryPhotos,
  getPhotographyPhotos
} from '@/lib/photography/notion'
import { withPhotographyMenu } from '@/themes/hexo/components/photographyMenu'

const page = (id, published = true) => ({
  id,
  properties: {
    标题: { title: [{ plain_text: '<照片>' }] },
    发布: { checkbox: published },
    分类: { select: { name: '街拍' } },
    照片: {
      files: [
        {
          file: {
            url: 'https://example.com/photo.jpg',
            expiry_time: new Date(Date.now() + 3600000).toISOString()
          }
        }
      ]
    }
  }
})

test('only published records with HTTPS media become public photos', () => {
  expect(normalizePhoto(page('hidden', false))).toBeNull()
  expect(normalizePhoto({ ...page('archived'), archived: true })).toBeNull()
  const invalid = page('invalid')
  invalid.properties.照片.files[0].file.url = 'javascript:alert(1)'
  expect(normalizePhoto(invalid)).toBeNull()
  expect(normalizePhoto(page('visible'))).toEqual({
    id: 'visible',
    title: '<照片>',
    category: 'street',
    src: 'https://example.com/photo.jpg'
  })
})

test('pagination keeps server ordering and empty databases stay empty', async () => {
  const query = jest
    .fn()
    .mockResolvedValueOnce({
      results: [page('one')],
      has_more: true,
      next_cursor: 'next'
    })
    .mockResolvedValueOnce({ results: [page('two')], has_more: false })
  const result = await queryPhotos({ databases: { query } }, 'db')
  expect(result.photos.map(p => p.id)).toEqual(['one', 'two'])
  expect(query.mock.calls[1][0].start_cursor).toBe('next')
  expect(query.mock.calls[0][0].filter).toEqual({
    property: '发布',
    checkbox: { equals: true }
  })
  query.mockResolvedValue({ results: [], has_more: false })
  expect((await queryPhotos({ databases: { query } }, 'db')).photos).toEqual([])
})

test('production is not silently filled with demo photos', async () => {
  const previous = { ...process.env }
  process.env.NODE_ENV = 'production'
  delete process.env.PHOTOGRAPHY_NOTION_TOKEN
  delete process.env.PHOTOGRAPHY_NOTION_DATABASE_ID
  delete process.env.PHOTOGRAPHY_DEMO
  try {
    await expect(getPhotographyPhotos()).rejects.toThrow('configuration')
  } finally {
    process.env = previous
  }
})

test('existing collection photo submenu is updated without duplication or mutation', () => {
  const links = [
    {
      name: '收藏集',
      subMenus: [
        { title: '摄影', href: '/old-photo' },
        { title: '书单', href: '/books' }
      ]
    }
  ]
  const updated = withPhotographyMenu(links)
  expect(updated[0].subMenus).toHaveLength(2)
  expect(updated[0].subMenus[0].href).toBe('/photography')
  expect(updated[0].subMenus[1].href).toBe('/books')
  expect(links[0].subMenus[0].href).toBe('/old-photo')
})
