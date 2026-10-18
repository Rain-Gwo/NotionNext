// Injects a "Music" entry under the "收藏集 / 收藏夹 (Collection)" menu group,
// mirroring how `photographyMenu.js` injects 摄影. Does NOT mutate the Notion
// menu object — it returns a new links array.
const MUSIC_ITEM = {
  id: 'music',
  icon: 'fa-solid fa-music',
  name: 'Music',
  title: 'Music',
  href: '/music',
  show: true
}

const isCollectionMenu = item => {
  const label = String(item?.name || item?.title || '')
    .trim()
    .toLowerCase()
  return ['收藏集', '收藏夹', 'collection', 'collections'].includes(label)
}

export const withMusicMenu = links => {
  const menu = Array.isArray(links) ? links : []

  // If a "Music" submenu already exists under the collection group, just make
  // sure its href points at /music (e.g. if Notion already had a placeholder).
  const collectionWithMusic = menu.find(
    item =>
      isCollectionMenu(item) &&
      item?.subMenus?.some(
        child =>
          String(child?.title || child?.name || '').trim().toLowerCase() ===
          'music'
      )
  )
  if (collectionWithMusic) {
    return menu.map(item =>
      item === collectionWithMusic
        ? {
            ...item,
            subMenus: item.subMenus.map(child =>
              String(child?.title || child?.name || '')
                .trim()
                .toLowerCase() === 'music'
                ? { ...child, href: '/music', target: '_self' }
                : child
            )
          }
        : item
    )
  }

  const alreadyExists = menu.some(
    item =>
      item?.href === MUSIC_ITEM.href ||
      item?.subMenus?.some(c => c?.href === MUSIC_ITEM.href)
  )
  if (alreadyExists) return menu

  const collectionIndex = menu.findIndex(isCollectionMenu)
  if (collectionIndex < 0) {
    return [
      ...menu,
      {
        id: 'music-collection',
        icon: 'fa-regular fa-images',
        name: '收藏集',
        href: '#',
        show: true,
        subMenus: [{ ...MUSIC_ITEM }]
      }
    ]
  }

  return menu.map((item, index) =>
    index === collectionIndex
      ? {
          ...item,
          subMenus: [...(item.subMenus || []), { ...MUSIC_ITEM }]
        }
      : item
  )
}
