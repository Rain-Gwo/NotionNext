/**
 * 中英语言切换菜单。
 *
 * 导航里的 English 是 Notion 自定义菜单里的一条绝对外链
 * (https://www.guohaobo.com/en, target=_blank)。本站不单独维护英文 Notion 库，
 * 而是用 Next.js i18n 的 /en 语言路由：内容回落默认中文库，界面文案走 en-US 字典。
 *
 * 这里在主题层覆盖那条菜单项，避免改动 Notion 数据：
 *  - 中文站：保持原绝对地址，但改成同标签跳转 (target=_self)
 *  - 英文站：把 English 改成「中文」，指回中文首页，方便切回去
 *
 * 用绝对地址是有意为之：SmartLink 会把它当外链渲染成原生 <a>，触发整页导航，
 * 让 Next.js 重新按 locale 解析；相对 /en 会被 next/link 接管，切 locale 时易出错。
 */
export const withLangMenu = (links, currentLocale) => {
  if (!Array.isArray(links)) {
    return links
  }

  const isEn = currentLocale === 'en'

  return links.map(link => {
    if (!link) {
      return link
    }
    const label = link.name || link.title || ''
    const href = typeof link.href === 'string' ? link.href : ''
    const isLangLink =
      /english/i.test(label) ||
      /^https?:\/\/[^/]+\/en\/?$/i.test(href) ||
      href === '/en'
    if (!isLangLink) {
      return link
    }

    const targetHref = isEn ? href.replace(/\/en\/?$/, '/') : href
    return {
      ...link,
      name: isEn ? '中文' : (label || 'English'),
      title: isEn ? '中文' : (link.title || label || 'English'),
      href: targetHref || 'https://www.guohaobo.com/',
      target: '_self',
      show: true
    }
  })
}
