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
  /** a check of a site that isn't on ms.computer, to tell "the probe's own internet is down" from "the sites are down" */
  control?: { ok: boolean; ms: number | null; error: string | null }
  checks: Check[]
}

/** A run whose own connection failed says nothing about the sites; it's left out, not counted as down. */
export const validRun = (r: Run) => r.control?.ok !== false

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
  /** happened during a network-wide outage */
  network?: boolean
}

/** Many sites down in the same check: a problem with ms.computer, not with one site. */
export interface Outage {
  start: string
  end: string | null
  runs: number
  /** most sites down at once, out of how many checked */
  peak: number
  of: number
}

/** A deploy seen from outside: ms.computer's own copy answered first, then miners took over. */
export interface Takeover {
  /** first answer from ms.computer's origin */
  start: string
  /** first answer from a miner's copy after that; null: still on origin */
  end: string | null
  /** minutes between the two (checks are 5 min apart, so ±5 min) */
  minutes: number | null
}

/** An outage is at least this share of the checked sites down in one run, and at least OUTAGE_MIN sites. */
export const OUTAGE_SHARE = 0.5
export const OUTAGE_MIN = 3

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
  takeovers: Takeover[]
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
  /** runs left out because the probe's own connection failed */
  skipped: number
  network: {
    outages: Outage[]
    /** the outage going on in the latest run, if any */
    outage: Outage | null
    /** median minutes from a deploy's first origin answer to the first miner answer, 7 days */
    takeoverMedian: number | null
    takeoverCount: number
  }
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

/** Runs where at least OUTAGE_SHARE of the sites (and OUTAGE_MIN) were down, grouped into stretches. */
export function outages(runs: Run[]): Outage[] {
  const out: Outage[] = []
  let open: Outage | null = null
  for (const r of runs) {
    const down = r.checks.filter((c) => !c.up).length
    const bad = r.checks.length > 0 && down >= OUTAGE_MIN && down / r.checks.length >= OUTAGE_SHARE
    if (bad) {
      if (!open) {
        open = { start: r.at, end: null, runs: 0, peak: 0, of: r.checks.length }
        out.push(open)
      }
      open.runs++
      if (down > open.peak) {
        open.peak = down
        open.of = r.checks.length
      }
    } else if (open) {
      open.end = r.at
      open = null
    }
  }
  return out
}

/** Each stretch of origin answers, ended by the first miner answer. Failed checks don't end it. */
export function takeovers(checks: { at: string; c: Check }[]): Takeover[] {
  const out: Takeover[] = []
  let open: Takeover | null = null
  for (const { at, c } of checks) {
    if (!c.up) continue
    if (c.upstream === 'origin' && !open) {
      open = { start: at, end: null, minutes: null }
      out.push(open)
    } else if (c.upstream === 'replica' && open) {
      open.end = at
      open.minutes = Math.round((Date.parse(at) - Date.parse(open.start)) / 60_000)
      open = null
    }
  }
  return out
}

const within = (at: string, o: Outage) => at >= o.start && (o.end == null || at < o.end)

/** Turns runs (any order, any days) into the summary the pages show. */
export function summarize(runs: Run[], sites: Site[], now: Date, run: Run['run'] = null): Summary {
  const end = hourStart(now.getTime()) + HOUR
  const start = end - WINDOW_HOURS * HOUR
  const day = now.getTime() - 24 * HOUR
  const inWindow = runs.filter((r) => Date.parse(r.at) >= start && Date.parse(r.at) < end)
  const sorted = inWindow.filter(validRun).sort((a, b) => a.at.localeCompare(b.at))
  const outs = outages(sorted)

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
      incidents: incidents(list)
        .map((i) => (outs.some((o) => within(i.start, o)) ? { ...i, network: true } : i))
        .reverse(),
      takeovers: takeovers(list).reverse(),
    }
  })
  const done = summaries.flatMap((s) => s.takeovers.filter((t) => t.minutes != null).map((t) => t.minutes!))
  const lastOut = outs.at(-1)
  return {
    v: 1,
    generated: now.toISOString(),
    run,
    hours,
    runsPerHour,
    from,
    skipped: inWindow.length - sorted.length,
    network: {
      outages: [...outs].reverse(),
      outage: lastOut && lastOut.end == null ? lastOut : null,
      takeoverMedian: percentile(done, 50),
      takeoverCount: done.length,
    },
    sites: summaries,
  }
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
