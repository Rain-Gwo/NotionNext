// About Me (Oliver Guo) — standalone full page inside the Next app.
//
// The real about page is a self-contained static HTML/CSS/JS site kept in
// `public/about/` (index.html + styles.css + script.js + assets). It cannot
// be a plain static file at `/about/index.html` because Cloudflare adds a
// `/zh-CN` locale prefix to every non-localed `.html` path, and Next i18n
// then strips it again — an infinite redirect loop (see MEMORY.md).
//
// So `/about` is a real Next.js route. It uses `getStaticProps` (the about
// content is a fixed static file, generated at build time) so Next.js prefetches
// it on the homepage and the About click navigates instantly. In `pages/_app.js` the theme Layout
// (which renders #top-nav, Footer and ExternalPlugins like the Live2D widget
// and chat buttons) is *skipped* for `/about`, exactly like `/photography`
// and `/passion`. That means on `/about` NONE of the blog's chrome mounts —
// the about page is a genuine standalone full page, so there is nothing to
// leak or cover. We simply read the static HTML at request time and inline
// its <body>, and inline /about/styles.css into <Head> so the page is
// styled from the first paint (no FOUC on client-side navigation).
import fs from 'fs'
import path from 'path'
import { useEffect, useLayoutEffect } from 'react'
import Head from 'next/head'
import Script from 'next/script'

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,900;1,400;1,500&family=Inter:wght@300;400;500;600&family=Noto+Serif+SC:wght@400;500;600;700&display=swap'

const FAVICON_HREF =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231a1a1a'/%3E%3Ctext x='16' y='22' font-size='18' text-anchor='middle' fill='%23f0ece4' font-family='Georgia,serif'%3EO%3C/text%3E%3C/svg%3E"

function readAboutHtml() {
  try {
    const file = path.join(process.cwd(), 'public/about/index.html')
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    return ''
  }
}

function readAboutCss() {
  try {
    const file = path.join(process.cwd(), 'public/about/styles.css')
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    return ''
  }
}

function pick(html, re) {
  const m = html.match(re)
  return m ? m[1] : ''
}

export async function getStaticProps() {
  const html = readAboutHtml()
  const title =
    pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '关于 — Oliver Guo'
  const desc =
    pick(html, /<meta name="description" content="([^"]*)"/i) ||
    'Oliver Guo 的个人介绍页'
  const body = pick(html, /<body[^>]*>([\s\S]*?)<\/body>/i)
  const css = readAboutCss()
  return { props: { title, desc, body, css } }
}

export default function About({ title, desc, body, css }) {
  // Add the `js` class before first paint so [data-reveal] elements start
  // hidden and fade in via IntersectionObserver (no flash of un-revealed
  // content). Runs on both hard load and client navigation.
  useIsomorphicLayoutEffect(() => {
    document.documentElement.classList.add('js')
    return () => document.documentElement.classList.remove('js')
  }, [])

  // Intercept clicks on internal (same-origin) links inside the about page
  // (Blog -> "/", Photos -> "/photography", ...) and force a real, same-tab
  // navigation. A plain <a href="/"> injected via dangerouslySetInnerHTML can
  // be swallowed by the blog's client router and stall on a "loading" state;
  // a hard navigation is reliable and stays in the same tab.
  useEffect(() => {
    const root = document.getElementById('about-root')
    if (!root) return
    const onClick = (e) => {
      const a = e.target.closest('a')
      if (!a) return
      const href = a.getAttribute('href') || ''
      // leave in-page anchors (#...), mailto:, and external/absolute links alone
      if (
        !href ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        /^https?:\/\//i.test(href)
      ) {
        return
      }
      if (href === '/about' || href === '/about/') return
      e.preventDefault()
      window.location.href = href
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [])

  return (
    <>
      <Head>
        {/* Defense in depth: also add `js` during HTML parse (hard load only). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "document.documentElement.classList.add('js')",
          }}
        />
        <title>{title}</title>
        <meta name='description' content={desc} />
        <link rel='icon' href={FAVICON_HREF} />
        <link rel='canonical' href='https://www.guohaobo.com/about/' />
        <meta property='og:type' content='website' />
        <meta property='og:title' content={title} />
        <meta property='og:description' content={desc} />
        <meta property='og:url' content='https://www.guohaobo.com/about/' />
        <meta
          property='og:image'
          content='https://www.guohaobo.com/about/assets/desktop-v2.jpg'
        />
        <meta name='twitter:card' content='summary_large_image' />
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link href={FONT_HREF} rel='stylesheet' />
        {/* 内联 about 样式：消除客户端跳转时的 FOUC（无样式闪现） */}
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </Head>

      <div
        id='about-root'
        style={{
          minHeight: '100vh',
          background: '#1a1a1a',
          color: '#f0ece4',
        }}
        dangerouslySetInnerHTML={{ __html: body }}
      />

      <Script src='/about/script.js' strategy='afterInteractive' />
    </>
  )
}
