/* eslint-disable @next/next/no-img-element */
import Head from 'next/head'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PHOTO_CATEGORIES } from '@/lib/photography/config'
import styles from './photography.module.css'

const cn = (...names) =>
  names
    .filter(Boolean)
    .map(name => styles[name])
    .join(' ')

function PhotoImage({ photo, lightbox = false }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (failed) {
    return (
      <span className={cn('og-fallback')}>
        <span>图片暂时无法显示</span>
        {lightbox && (
          <button
            type='button'
            onClick={() => {
              setFailed(false)
              setAttempt(value => value + 1)
            }}
          >
            重新加载
          </button>
        )}
      </span>
    )
  }
  return (
    <img
      key={attempt}
      className={lightbox ? cn('og-lightbox-img') : undefined}
      src={photo.src}
      alt={photo.title}
      loading={lightbox ? 'eager' : 'lazy'}
      decoding='async'
      onError={() => setFailed(true)}
    />
  )
}

function Lightbox({ photos, initialIndex, onClose }) {
  const [index, setIndex] = useState(initialIndex)
  const dialog = useRef(null)
  const touchStart = useRef(null)
  const step = direction =>
    setIndex(value => (value + direction + photos.length) % photos.length)
  const photo = photos[index]

  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    const overflow = document.body.style.overflow
    element.showModal()
    document.body.style.overflow = 'hidden'
    return () => {
      element.close()
      document.body.style.overflow = overflow
      previousFocus?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className={cn('og-lightbox')}
      aria-label='照片查看器'
      aria-describedby='photo-caption'
      onCancel={event => {
        event.preventDefault()
        onClose()
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          step(event.key === 'ArrowRight' ? 1 : -1)
        }
      }}
      onTouchStart={event => {
        const touch = event.touches[0]
        touchStart.current = { x: touch.clientX, y: touch.clientY }
      }}
      onTouchEnd={event => {
        if (!touchStart.current) return
        const touch = event.changedTouches[0]
        const dx = touch.clientX - touchStart.current.x
        const dy = touch.clientY - touchStart.current.y
        touchStart.current = null
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy))
          step(dx < 0 ? 1 : -1)
      }}
    >
      <span className={cn('og-lightbox-count')}>
        {index + 1} / {photos.length}
      </span>
      <button
        type='button'
        className={cn('og-lightbox-close')}
        aria-label='关闭'
        onClick={onClose}
      >
        ×
      </button>
      {photos.length > 1 && (
        <button
          type='button'
          className={cn('og-lightbox-nav', 'og-lightbox-prev')}
          aria-label='上一张'
          onClick={() => step(-1)}
        >
          ‹
        </button>
      )}
      <PhotoImage key={photo.id + photo.src} photo={photo} lightbox />
      {photos.length > 1 && (
        <button
          type='button'
          className={cn('og-lightbox-nav', 'og-lightbox-next')}
          aria-label='下一张'
          onClick={() => step(1)}
        >
          ›
        </button>
      )}
      <div
        id='photo-caption'
        className={cn('og-lightbox-caption')}
        aria-live='polite'
      >
        {photo.title} · {PHOTO_CATEGORIES[photo.category]}
      </div>
    </dialog>
  )
}

export default function Photography() {
  const [photos, setPhotos] = useState([])
  const [state, setState] = useState('loading')
  const [category, setCategory] = useState('all')
  const [selection, setSelection] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showBackToTop, setShowBackToTop] = useState(false)
  const requestRef = useRef(null)
  const alive = useRef(false)

  const loadPhotos = useCallback(async () => {
    if (requestRef.current) return
    const controller = new AbortController()
    requestRef.current = controller
    const timer = setTimeout(() => controller.abort(), 25000)
    try {
      const response = await fetch('/api/photography', {
        signal: controller.signal,
        cache: 'no-store'
      })
      if (!response.ok) throw new Error('Gallery unavailable')
      const data = await response.json()
      if (!Array.isArray(data.photos))
        throw new Error('Invalid gallery response')
      if (alive.current) {
        setPhotos(data.photos)
        setState('ready')
      }
    } catch {
      if (alive.current) setState('error')
    } finally {
      clearTimeout(timer)
      if (requestRef.current === controller) requestRef.current = null
    }
  }, [])

  useEffect(() => {
    alive.current = true
    loadPhotos()
    const refresh = () => {
      if (!document.hidden) loadPhotos()
    }
    const interval = setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive.current = false
      requestRef.current?.abort()
      requestRef.current = null
      clearInterval(interval)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [loadPhotos])

  useEffect(() => {
    const updateVisibility = () => setShowBackToTop(window.scrollY > 360)
    updateVisibility()
    window.addEventListener('scroll', updateVisibility, { passive: true })
    return () => window.removeEventListener('scroll', updateVisibility)
  }, [])

  const filtered = photos.filter(
    photo => category === 'all' || photo.category === category
  )
  const close = useCallback(() => setSelection(null), [])

  return (
    <div className={styles.page} id='og-photography'>
      <Head>
        <title>Photography | O.G.</title>
        <meta
          name='description'
          content='O.G. 的摄影作品集 — 街拍、人像、风光、随拍'
        />
        <meta name='theme-color' content='#0a0a0a' />
        <link rel='canonical' href='https://guohaobo.com/photography' />
      </Head>
      <header className={cn('og-navbar')}>
        <div className={cn('og-navbar-inner')}>
          <Link className={cn('og-brand')} href='/' aria-label='O.G. 首页'>
            O.G.
          </Link>
          <nav
            aria-label='主导航'
            id='photography-navigation'
            className={cn('og-nav-links', menuOpen && 'og-open')}
          >
            <Link href='/'>首页</Link>
            <Link href='/passion'>Passion</Link>
          </nav>
          <button
            type='button'
            className={cn('og-menu-toggle')}
            aria-label={menuOpen ? '关闭导航' : '打开导航'}
            aria-expanded={menuOpen}
            aria-controls='photography-navigation'
            onClick={() => setMenuOpen(value => !value)}
          >
            {menuOpen ? '×' : '☰'}
          </button>
        </div>
      </header>
      <main>
        <section className={cn('og-hero')}>
          <h1>Photography</h1>
        </section>
        <div
          className={cn('og-filter-bar')}
          role='group'
          aria-label='筛选摄影作品'
        >
          {Object.entries({ all: '全部', ...PHOTO_CATEGORIES }).map(
            ([key, label]) => (
              <button
                key={key}
                type='button'
                className={cn('og-filter-btn', category === key && 'og-active')}
                aria-pressed={category === key}
                onClick={() => setCategory(key)}
              >
                {label}
              </button>
            )
          )}
        </div>
        {state === 'loading' && (
          <div className={cn('og-loading')} role='status'>
            <div className={cn('og-spinner')} />
            <p>正在加载照片…</p>
          </div>
        )}
        {state === 'error' && (
          <div className={cn('og-status')} role='status'>
            照片暂时无法更新，请稍后重试。
            <button
              type='button'
              onClick={() => {
                void loadPhotos()
              }}
            >
              重新加载
            </button>
          </div>
        )}
        {state === 'ready' && filtered.length === 0 && (
          <div className={cn('og-status')} role='status'>
            这个分类还没有照片
          </div>
        )}
        <section className={cn('og-gallery')} aria-label='摄影作品'>
          {filtered.map((photo, index) => (
            <figure className={cn('og-gallery-item')} key={photo.id}>
              <button
                type='button'
                className={cn('og-photo-button')}
                aria-label={'查看照片：' + photo.title}
                onClick={() => setSelection({ photos: filtered, index })}
              >
                <PhotoImage key={photo.src} photo={photo} />
              </button>
              <figcaption
                className={cn('og-overlay')}
                style={{ pointerEvents: 'none' }}
              >
                <div className={cn('og-overlay-title')}>{photo.title}</div>
                <div className={cn('og-overlay-meta')}>
                  {PHOTO_CATEGORIES[photo.category]}
                </div>
              </figcaption>
            </figure>
          ))}
        </section>
      </main>
      <footer className={cn('og-footer')}>
        <p>
          O.G. · <Link href='/'>guohaobo.com</Link>
        </p>
      </footer>
      {showBackToTop && (
        <button
          type='button'
          className={cn('og-back-to-top')}
          aria-label='回到顶部'
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <span aria-hidden='true'>↑</span>
        </button>
      )}
      {selection && (
        <Lightbox
          photos={selection.photos}
          initialIndex={selection.index}
          onClose={close}
        />
      )}
    </div>
  )
}
