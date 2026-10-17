// About Me (Oliver Guo) — standalone static site rendered inside the Next app.
//
// The real about page is a self-contained static HTML/CSS/JS site kept in
// `public/about/` (index.html + styles.css + script.js + assets). It cannot be
// a plain static file at `/about/index.html` because:
//   - Cloudflare adds a `/zh-CN` locale prefix to every non-localed `.html`
//     path, and Next i18n then strips it again -> an infinite redirect loop.
//   - A client-side <Link href="/about"> could not resolve a bare static file.
//
// So `/about` is a real Next.js route. This page reads the static HTML at
// request time, inlines its <body>, and re-adds its <head> links (fonts,
// styles.css, meta). A scoped `html.about-page` stylesheet hides the blog
// Header/Footer and lets the about page go full-bleed on its own dark theme.
import fs from 'fs'
import path from 'path'
import { useEffect } from 'react'
import Head from 'next/head'
import Script from 'next/script'

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,900;1,400;1,500&family=Inter:wght@300;400;500;600&family=Noto+Serif+SC:wght@400;500;600;700&display=swap'

const SCOPED_CSS = `
html.about-page { background:#1a1a1a !important; overflow-x:hidden; }
html.about-page #top-nav,
html.about-page footer { display:none !important; }
html.about-page #theme-hexo { background:#1a1a1a !important; }
html.about-page #wrapper {
  padding-top:0 !important; padding-left:0 !important; padding-right:0 !important;
  background:#1a1a1a !important; min-height:100vh !important;
}
html.about-page #container-inner {
  display:block !important; max-width:none !important; margin:0 !important; padding:0 !important;
}
html.about-page #container-inner > div {
  max-width:none !important; width:100% !important; height:auto !important;
  overflow:visible !important; padding:0 !important;
}
html.about-page #about-root {
  color:#f0ece4; background:#1a1a1a;
  font-family:'Inter','Noto Serif SC',system-ui,sans-serif;
}
`

function readAboutHtml() {
  try {
    const file = path.join(process.cwd(), 'public/about/index.html')
    return fs.readFileSync(file, 'utf8')
  } catch (e) {
    return ''
  }
}

function pick(html, re) {
  const m = html.match(re)
  return m ? m[1] : ''
}

export async function getServerSideProps() {
  const html = readAboutHtml()
  const title =
    pick(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || '关于 — Oliver Guo'
  const desc =
    pick(html, /<meta name="description" content="([^"]*)"/i) ||
    'Oliver Guo 的个人介绍页'
  const body = pick(html, /<body[^>]*>([\s\S]*?)<\/body>/i)
  return { props: { title, desc, body } }
}

export default function About({ title, desc, body }) {
  // Remove the full-bleed flag if the user navigates away from this page.
  useEffect(() => {
    return () => document.documentElement.classList.remove('about-page')
  }, [])

  return (
    <>
      <Head>
        {/* Run before paint: mark <html> as js (so [data-reveal] starts hidden
            and fades in via IntersectionObserver) and as about-page (so the
            scoped stylesheet hides the blog chrome — no flash of the framed
            version). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('js');document.documentElement.classList.add('about-page')",
          }}
        />
        <title>{title}</title>
        <meta name='description' content={desc} />
        <link
          rel='icon'
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231a1a1a'/%3E%3Ctext x='16' y='22' font-size='18' text-anchor='middle' fill='%23f0ece4' font-family='Georgia,serif'%3EO%3C/text%3E%3C/svg%3E"
        />
        <link rel='canonical' href='https://www.guohaobo.com/about/' />
        <meta property='og:type' content='website' />
        <meta property='og:title' content={title} />
        <meta property='og:description' content={desc} />
        <meta property='og:url' content='https://www.guohaobo.com/about/' />
        <meta
          property='og:image'
          content='https://www.guohaobo.com/about/assets/desktop.jpg'
        />
        <meta name='twitter:card' content='summary_large_image' />
        <link rel='preconnect' href='https://fonts.googleapis.com' />
        <link rel='preconnect' href='https://fonts.gstatic.com' crossOrigin='anonymous' />
        <link href={FONT_HREF} rel='stylesheet' />
        <link rel='stylesheet' href='/about/styles.css' />
        <style dangerouslySetInnerHTML={{ __html: SCOPED_CSS }} />
      </Head>

      <div id='about-root' dangerouslySetInnerHTML={{ __html: body }} />

      <Script src='/about/script.js' strategy='afterInteractive' />
    </>
  )
}
