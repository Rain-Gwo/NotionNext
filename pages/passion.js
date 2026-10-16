import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from './photography.module.css'

// Rotate through a small collection of thoughts in a quiet typewriter loop.
const PASSION_GREETINGS = [
  '希望是蓝色的以太。',
  '窗外是佛罗伦萨，桌上是死。',
  '无论走到哪里，都应该记住，过去都是假的，回忆是一条没有归途的路，以往的一切春天都无法复原。',
  '我时常聆听它，时常注视它的眼睛，我总能跟它学到许多。一条河可以教会人许多东西。',
  '在一切苦行的尽头，在一切悲伤的尽头，我想象出并预见到另一种快乐，那种纯洁而神秘的天使般的快乐，是我的心灵渴望已久的。'
]

const TYPE_SPEED = 80
const DELETE_SPEED = 40
const PAUSE = 5000

const cn = (...names) =>
  names
    .filter(Boolean)
    .map(name => styles[name])
    .join(' ')

function TypewriterGreeting() {
  const [textIndex, setTextIndex] = useState(0)
  const [displayed, setDisplayed] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [showCursor, setShowCursor] = useState(true)

  useEffect(() => {
    const cursorInterval = window.setInterval(
      () => setShowCursor(value => !value),
      530
    )
    return () => window.clearInterval(cursorInterval)
  }, [])

  useEffect(() => {
    const current = PASSION_GREETINGS[textIndex]
    let timeout

    if (!isDeleting && displayed.length < current.length) {
      timeout = window.setTimeout(
        () => setDisplayed(current.slice(0, displayed.length + 1)),
        TYPE_SPEED
      )
    } else if (!isDeleting) {
      timeout = window.setTimeout(() => setIsDeleting(true), PAUSE)
    } else if (displayed.length > 0) {
      timeout = window.setTimeout(
        () => setDisplayed(current.slice(0, displayed.length - 1)),
        DELETE_SPEED
      )
    } else {
      setIsDeleting(false)
      setTextIndex(index => (index + 1) % PASSION_GREETINGS.length)
    }

    return () => window.clearTimeout(timeout)
  }, [displayed, isDeleting, textIndex])

  return (
    <p className={cn('og-passion-greeting')} aria-label={displayed}>
      <span>{displayed}</span>
      <span
        className={cn('og-passion-cursor')}
        aria-hidden='true'
        style={{ opacity: showCursor ? 1 : 0 }}
      />
    </p>
  )
}

export default function Passion() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className={styles.page} id='og-passion'>
      <Head>
        <title>思考 | O.G.</title>
        <meta name='description' content='O.G. 的思考页面' />
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
            <Link href='/photography'>返回</Link>
            <Link className={cn('og-nav-current')} href='/passion'>
              思考
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
          <TypewriterGreeting />
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
