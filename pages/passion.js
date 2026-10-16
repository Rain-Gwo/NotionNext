import Head from 'next/head'
import Link from 'next/link'
import { useState } from 'react'
import styles from './photography.module.css'

const PASSION_COPY = '我还在想，什么值得被留在这里。'

const cn = (...names) =>
  names
    .filter(Boolean)
    .map(name => styles[name])
    .join(' ')

export default function Passion() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={styles.page} id='og-passion'>
      <Head>
        <title>Passion | O.G.</title>
        <meta name='description' content='O.G. 的 Passion 页面' />
        <meta name='theme-color' content='#0a0a0a' />
        <link rel='canonical' href='https://guohaobo.com/passion' />
      </Head>
      <header className={cn('og-navbar')}>
        <div className={cn('og-navbar-inner')}>
          <Link className={cn('og-brand')} href='/' aria-label='O.G. 首页'>
            O.G.
          </Link>
          <nav
            aria-label='主导航'
            id='passion-navigation'
            className={cn('og-nav-links', menuOpen && 'og-open')}
          >
            <Link href='/'>首页</Link>
            <Link className={cn('og-nav-current')} href='/passion'>
              Passion
            </Link>
          </nav>
          <button
            type='button'
            className={cn('og-menu-toggle')}
            aria-label={menuOpen ? '关闭导航' : '打开导航'}
            aria-expanded={menuOpen}
            aria-controls='passion-navigation'
            onClick={() => setMenuOpen(value => !value)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>
      </header>
      <main className={cn('og-passion-main')}>
        <div className={cn('og-passion-content')}>
          <h1>Passion</h1>
          <p>{PASSION_COPY}</p>
        </div>
      </main>
      <footer className={cn('og-footer')}>
        <p>
          O.G. · <Link href='/'>guohaobo.com</Link>
        </p>
      </footer>
    </div>
  )
}
