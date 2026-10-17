// Bridge page for the standalone "About Me" (Oliver Guo) site.
//
// The real about page is a self-contained static HTML site served from
// `public/about/index.html` (see the `/about` -> `/about/index.html` rewrite
// in next.config.js). It is NOT part of the Next.js page system, so a
// client-side <Link href="/about"> navigation from the nav menu could not
// resolve it (the dynamic [prefix] route would swallow the path and error).
//
// This page exists only so that `/about` is a real Next.js route. Both the
// server (getServerSideProps) and the client (useEffect fallback) hand off to
// the static site with a full document load.
import { useEffect } from 'react'

export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/about/index.html',
      permanent: false,
    },
  }
}

export default function About() {
  useEffect(() => {
    window.location.replace('/about/index.html')
  }, [])
  return null
}
