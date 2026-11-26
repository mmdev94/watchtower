import { useEffect, useState } from 'react'

export type Route = { page: 'network' } | { page: 'site'; slug: string } | { page: 'how' }

export function parse(hash: string): Route {
  const h = hash.replace(/^#/, '')
  const site = /^\/site\/([a-z0-9-]+)$/.exec(h)
  if (site) return { page: 'site', slug: site[1] }
  if (h === '/how') return { page: 'how' }
  return { page: 'network' }
}

export const href = {
  home: '#/',
  site: (slug: string) => `#/site/${slug}`,
  how: (section?: string) => `#/how${section ? `?${section}` : ''}`,
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parse(window.location.hash.split('?')[0]))
  useEffect(() => {
    const on = () => {
      setR(parse(window.location.hash.split('?')[0]))
      const section = window.location.hash.split('?')[1]
      if (section) setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth' }), 50)
      else window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return r
}
