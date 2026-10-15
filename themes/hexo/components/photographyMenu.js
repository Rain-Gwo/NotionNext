const PHOTOGRAPHY_ITEM = {
  id: 'photography',
  icon: 'fa-solid fa-camera',
  name: '摄影',
  title: '摄影',
  href: '/photography',
  show: true
}

const isCollectionMenu = item => {
  const label = String(item?.name || item?.title || '')
    .trim()
    .toLowerCase()
  return label === '收藏集' || label === 'collection' || label === 'collections'
}

/**
 * 将摄影入口放入“收藏集”，不直接修改 Notion 返回的菜单对象。
 * 如果 Notion 中还没有收藏集，则补一个只包含摄影的低调分组。
 */
export const withPhotographyMenu = links => {
  const menu = Array.isArray(links) ? links : []
  // A Notion SubMenu may still point at the previous gallery URL.
  // Preserve its position and metadata, updating only this specific entry.
  const collectionWithPhoto = menu.find(
    item =>
      isCollectionMenu(item) &&
      item?.subMenus?.some(
        child => String(child?.title || child?.name || '').trim() === '摄影'
      )
  )
  if (collectionWithPhoto) {
    return menu.map(item =>
      item === collectionWithPhoto
        ? {
            ...item,
            subMenus: item.subMenus.map(child =>
              String(child?.title || child?.name || '').trim() === '摄影'
                ? { ...child, href: '/photography', target: '_self' }
                : child
            )
          }
        : item
    )
  }
  const alreadyExists = menu.some(
    item =>
      item?.href === PHOTOGRAPHY_ITEM.href ||
      item?.subMenus?.some(child => child?.href === PHOTOGRAPHY_ITEM.href)
  )

  if (alreadyExists) {
    return menu
  }

  const collectionIndex = menu.findIndex(isCollectionMenu)
  if (collectionIndex < 0) {
    return [
      ...menu,
      {
        id: 'photography-collection',
        icon: 'fa-regular fa-images',
        name: '收藏集',
        href: '#',
        show: true,
        subMenus: [{ ...PHOTOGRAPHY_ITEM }]
      }
    ]
  }

  return menu.map((item, index) =>
    index === collectionIndex
      ? {
          ...item,
          subMenus: [...(item.subMenus || []), { ...PHOTOGRAPHY_ITEM }]
        }
      : item
  )
}
