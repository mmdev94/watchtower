// Watchtower's data, and the maths on it. The probe (scripts/probe.ts) writes
// one Run every 5 minutes; summarize() turns the last 7 days of runs into what
// the pages show. Both sides use this file, so the numbers on the site are
// computed by exactly the code anyone can read here.

/** One look at one site. Times are milliseconds from the start of the request. */
export interface Check {
  url: string
  /** answered with a 2xx or 3xx */
  up: boolean
  status: number | null
  /** time to the first byte of the answer: what a visitor waits for */
  ttfb: number | null
  /** time until the whole page arrived */
  total: number | null
  /** the parts of ttfb: finding the address, connecting, the secure handshake */
  dns: number | null
  connect: number | null
  tls: number | null
  /** time from sending the request to the first byte: the server's share */
  wait: number | null
  /** ms.computer's `x-ms-edge-upstream` header ("replica" = a miner's copy answered) */
  upstream: string | null
  /** the Cloudflare location that handled it, from `cf-ray` (e.g. "DFW") */
  colo: string | null
  bytes: number | null
  /** why it failed, in words */
  error: string | null
  /** 2 when the first try failed and it was tried again 5 s later */
  tries: number
  /** what went wrong on the first try, when the second one worked */
  firstError?: string | null
}

export interface Run {
  v: 1
  /** when the run started (ISO) */
  at: string
  /** the GitHub Actions run that measured it; null for a run on someone's own machine */
  run: { id: string; attempt: number; url: string } | null
  /** the commit of the probe code that ran */
  sha: string | null
  checks: Check[]
}

export interface Site {
  url: string
  name: string
  repo: string | null
  /** where Watchtower learned of it */
  source: 'list' | 'topic'
}

export interface Incident {
  start: string
  /** null: still down */
  end: string | null
  checks: number
  /** what the failing checks said, e.g. "503" or "No answer within 15 s" */
  reason: string
}

/** One hour of one site: [checks, up, median ttfb (ms) or null, answered by a replica] */
export type Hour = [number, number, number | null, number] | null

export interface SiteSummary extends Site {
  last: (Check & { at: string }) | null
  /** aligned with Summary.hours */
  h: Hour[]
  up24: number | null
  up7: number | null
  checks24: number
  ttfb50: number | null
  ttfb90: number | null
  wait50: number | null
  /** share of good answers in 24 h that came from a replica */
  replica24: number | null
  incidents: Incident[]
}

export interface Summary {
  v: 1
  generated: string
  /** the run this summary was made in */
  run: Run['run']
  /** start of each hour bucket, oldest first (ISO) */
  hours: string[]
  /** runs seen per hour: shows gaps where GitHub didn't run the schedule */
  runsPerHour: number[]
  /** where the checks came from: Cloudflare locations and how often */
  from: Record<string, number>
  sites: SiteSummary[]
}

export const HOUR = 3_600_000
export const WINDOW_HOURS = 168

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
  return Math.round(s[i])
}

const hourStart = (t: number) => Math.floor(t / HOUR) * HOUR

/** "503" / "No answer within 15 s": one short reason for a failed check. */
export function reasonOf(c: Check): string {
  if (c.error) return c.error
  if (c.status) return `HTTP ${c.status}${STATUS_WORDS[c.status] ? ` (${STATUS_WORDS[c.status]})` : ''}`
  return 'Unknown error'
}

export const STATUS_WORDS: Record<number, string> = {
  404: 'not found',
  421: 'address not known to ms.computer',
  500: 'server error',
  502: 'bad gateway',
  503: 'service unavailable',
  504: 'gateway timeout',
}

/** Down stretches: they start at the first failed check and end at the next good one. */
export function incidents(checks: { at: string; c: Check }[]): Incident[] {
  const out: Incident[] = []
  let open: Incident | null = null
  for (const { at, c } of checks) {
    if (!c.up) {
      if (!open) {
        open = { start: at, end: null, checks: 0, reason: reasonOf(c) }
        out.push(open)
      }
      open.checks++
    } else if (open) {
      open.end = at
      open = null
    }
  }
  return out
}

/** Turns runs (any order, any days) into the summary the pages show. */
export function summarize(runs: Run[], sites: Site[], now: Date, run: Run['run'] = null): Summary {
  const end = hourStart(now.getTime()) + HOUR
  const start = end - WINDOW_HOURS * HOUR
  const day = now.getTime() - 24 * HOUR
  const sorted = runs.filter((r) => Date.parse(r.at) >= start && Date.parse(r.at) < end).sort((a, b) => a.at.localeCompare(b.at))

  const hours = Array.from({ length: WINDOW_HOURS }, (_, i) => new Date(start + i * HOUR).toISOString())
  const runsPerHour = hours.map(() => 0)
  const from: Record<string, number> = {}
  for (const r of sorted) {
    runsPerHour[Math.floor((Date.parse(r.at) - start) / HOUR)]++
    for (const c of r.checks) if (c.colo) from[c.colo] = (from[c.colo] ?? 0) + 1
  }

  const byUrl = new Map<string, { at: string; c: Check }[]>()
  for (const r of sorted) for (const c of r.checks) (byUrl.get(c.url) ?? byUrl.set(c.url, []).get(c.url)!).push({ at: r.at, c })

  const summaries = sites.map((site): SiteSummary => {
    const list = byUrl.get(site.url) ?? []
    const buckets: { at: string; c: Check }[][] = hours.map(() => [])
    for (const x of list) buckets[Math.floor((Date.parse(x.at) - start) / HOUR)].push(x)
    const h: Hour[] = buckets.map((b) =>
      b.length
        ? [b.length, b.filter((x) => x.c.up).length, percentile(b.filter((x) => x.c.up && x.c.ttfb != null).map((x) => x.c.ttfb!), 50), b.filter((x) => x.c.up && x.c.upstream === 'replica').length]
        : null,
    )
    const last24 = list.filter((x) => Date.parse(x.at) >= day)
    const good24 = last24.filter((x) => x.c.up)
    const ttfbs = good24.map((x) => x.c.ttfb).filter((v): v is number => v != null)
    const waits = good24.map((x) => x.c.wait).filter((v): v is number => v != null)
    const last = list.at(-1)
    return {
      ...site,
      last: last ? { ...last.c, at: last.at } : null,
      h,
      up24: last24.length ? good24.length / last24.length : null,
      up7: list.length ? list.filter((x) => x.c.up).length / list.length : null,
      checks24: last24.length,
      ttfb50: percentile(ttfbs, 50),
      ttfb90: percentile(ttfbs, 90),
      wait50: percentile(waits, 50),
      replica24: good24.length ? good24.filter((x) => x.c.upstream === 'replica').length / good24.length : null,
      incidents: incidents(list).reverse(),
    }
  })
  return { v: 1, generated: now.toISOString(), run, hours, runsPerHour, from, sites: summaries }
}

/** "chrono-n2732" from "https://chrono-n2732.ms.computer" — the id used in page addresses and file names. */
export const slug = (url: string) => new URL(url).hostname.replace(/\.ms\.computer$/, '')

/** "Chrono" from "chrono-n2732": drops the random suffix ms.computer adds. */
export function nameFromHost(host: string): string {
  const base = host.replace(/\.ms\.computer$/, '').replace(/-[a-z]\d{4}$/, '')
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

const MS_URL = /^https:\/\/[a-z0-9-]+\.ms\.computer\/?$/i
/** A clean https://name.ms.computer address, or null. */
export function msUrl(s: string | null | undefined): string | null {
  const v = (s ?? '').trim()
  return MS_URL.test(v) ? v.replace(/\/$/, '').toLowerCase() : null
}
