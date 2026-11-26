// The probe: looks at every listed ms.computer site once, writes what it saw,
// and recomputes the summary. GitHub Actions runs it every 5 minutes
// (.github/workflows/probe.yml); you can run it on your own machine too:
//
//   node --experimental-strip-types scripts/probe.ts --out ./my-data
//
// It sends one ordinary GET per site (two if the first fails), with a
// user-agent that says who's asking. Nothing else.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import https from 'node:https'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { badgeSvg } from '../src/lib/badge.ts'
import { atom, networkEntries, siteEntries } from '../src/lib/feed.ts'
import { msUrl, nameFromHost, slug, summarize, type Check, type Run, type Site } from '../src/lib/model.ts'

export const UA = 'Watchtower/1.0 (+https://github.com/mmdev94/watchtower; uptime checks for ms.computer sites, every 5 min)'
const TIMEOUT = 15_000
const RETRY_AFTER = 5_000
const MAX_BYTES = 5_000_000
const PARALLEL = 4
const TOPIC = 'ms-computer'

const ERRORS: Record<string, string> = {
  ENOTFOUND: 'Address not found (DNS)',
  EAI_AGAIN: 'Address lookup failed (DNS)',
  ECONNREFUSED: 'Connection refused',
  ECONNRESET: 'Connection dropped',
  ETIMEDOUT: 'No answer within 15 s',
  TIMEOUT: 'No answer within 15 s',
  CERT_HAS_EXPIRED: 'Security certificate expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'Security certificate doesn’t match the address',
}
export const errorWords = (code: string | undefined, message: string) => (code && ERRORS[code]) || message || 'Request failed'

const ms = (from: number, to: number | null) => (to == null ? null : Math.round(to - from))

/** One GET, timed phase by phase. Never throws. */
export function measure(url: string, timeout = TIMEOUT): Promise<Check> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const at: { dns: number | null; connect: number | null; tls: number | null; ttfb: number | null } = { dns: null, connect: null, tls: null, ttfb: null }
    let done = false
    const base = { url, upstream: null, colo: null, bytes: null, tries: 1 }
    const finish = (c: Omit<Check, 'dns' | 'connect' | 'tls' | 'ttfb' | 'wait'>) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({
        ...c,
        ttfb: ms(t0, at.ttfb),
        dns: ms(t0, at.dns),
        connect: ms(t0, at.connect),
        tls: ms(t0, at.tls),
        wait: at.ttfb != null && at.tls != null ? Math.round(at.ttfb - at.tls) : null,
      })
    }
    const req = https.request(
      url,
      { method: 'GET', agent: false, headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8', 'cache-control': 'no-cache' } },
      (res) => {
        at.ttfb = performance.now()
        const status = res.statusCode ?? null
        const upstream = (res.headers['x-ms-edge-upstream'] as string | undefined) ?? null
        const ray = (res.headers['cf-ray'] as string | undefined) ?? ''
        const colo = /-([A-Z]{3})$/.exec(ray)?.[1] ?? null
        let bytes = 0
        res.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > MAX_BYTES) res.destroy()
        })
        const end = () => {
          const up = status != null && status >= 200 && status < 400
          finish({ ...base, up, status, total: ms(t0, performance.now()), upstream, colo, bytes, error: null })
        }
        res.on('end', end)
        res.on('close', end)
      },
    )
    req.on('socket', (s) => {
      s.on('lookup', () => (at.dns = performance.now()))
      s.on('connect', () => (at.connect = performance.now()))
      s.on('secureConnect', () => (at.tls = performance.now()))
    })
    req.on('error', (e: NodeJS.ErrnoException) => finish({ ...base, up: false, status: null, total: null, error: errorWords(e.code, e.message) }))
    const timer = setTimeout(() => {
      finish({ ...base, up: false, status: null, total: null, error: ERRORS.TIMEOUT })
      req.destroy()
    }, timeout)
    req.end()
  })
}

/** A site counts as down only if two tries, 5 s apart, both fail. */
export async function check(url: string, m: (u: string) => Promise<Check> = measure, wait = (t: number) => new Promise((r) => setTimeout(r, t))): Promise<Check> {
  const first = await m(url)
  if (first.up) return first
  await wait(RETRY_AFTER)
  const second = await m(url)
  return { ...second, tries: 2, firstError: second.up ? (first.error ?? `HTTP ${first.status}`) : undefined }
}

export async function checkAll(sites: Site[], c: (u: string) => Promise<Check> = check): Promise<Check[]> {
  const out: Check[] = new Array(sites.length)
  let next = 0
  const worker = async () => {
    while (next < sites.length) {
      const i = next++
      out[i] = await c(sites[i].url)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, sites.length) }, worker))
  return out
}

// ── which sites ──────────────────────────────────────────────────────────────

export interface Config {
  /** Watchtower's own address, for links in feeds and alerts (empty until it's deployed) */
  site?: string
  sites: { url: string; name?: string; repo?: string }[]
  exclude: string[]
}

/** Not an ms.computer site: if even this fails, the probe's own connection is the problem. */
export const CONTROL = 'https://github.com/robots.txt'

type Get = <T>(path: string) => Promise<T>

/** Repos tagged ms-computer whose address we can find: the Website field, or the repo's latest GitHub deployment to an `ms-computer` environment. */
export async function topicSites(get: Get, lookups = 30): Promise<Site[]> {
  const q = encodeURIComponent(`topic:${TOPIC} archived:false`)
  const res = await get<{ items: { name: string; full_name: string; homepage: string | null; owner: { login: string } }[] }>(`/search/repositories?q=${q}&sort=updated&per_page=100`)
  const out: Site[] = []
  for (const r of res.items) {
    let url = msUrl(r.homepage)
    if (!url && lookups-- > 0) {
      try {
        const deps = await get<{ id: number }[]>(`/repos/${r.full_name}/deployments?environment=ms-computer&per_page=1`)
        if (deps[0]) {
          const st = await get<{ state: string; environment_url: string }[]>(`/repos/${r.full_name}/deployments/${deps[0].id}/statuses?per_page=1`)
          if (st[0]?.state === 'success') url = msUrl(st[0].environment_url)
        }
      } catch {
        /* not readable: skip this one */
      }
    }
    if (url) out.push({ url, name: nameFromHost(new URL(url).hostname), repo: r.full_name, source: 'topic' })
  }
  return out
}

/** The list for this run: the config's sites first, then tagged repos; no duplicates, nothing excluded. */
export function mergeSites(config: Config, topic: Site[]): Site[] {
  const seen = new Set(config.exclude.map((u) => msUrl(u) ?? u))
  const out: Site[] = []
  const add = (s: Site) => {
    if (seen.has(s.url)) return
    seen.add(s.url)
    out.push(s)
  }
  for (const s of config.sites) {
    const url = msUrl(s.url)
    if (url) add({ url, name: s.name ?? nameFromHost(new URL(url).hostname), repo: s.repo ?? null, source: 'list' })
  }
  for (const s of topic) {
    const listed = out.find((o) => o.url === s.url)
    if (listed && !listed.repo) listed.repo = s.repo
    add(s)
  }
  return out
}

function githubGet(token: string | undefined): Get {
  return async <T>(path: string) => {
    const res = await fetch(`https://api.github.com${path}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': UA, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`)
    return (await res.json()) as T
  }
}

// ── files ────────────────────────────────────────────────────────────────────

const readJson = async <T>(path: string): Promise<T | null> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** The runs from the last 8 day files (enough to cover 7 days). */
export async function readRuns(dir: string): Promise<Run[]> {
  let names: string[] = []
  try {
    names = (await readdir(join(dir, 'days'))).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().slice(-8)
  } catch {
    return []
  }
  const runs: Run[] = []
  for (const n of names) {
    for (const line of (await readFile(join(dir, 'days', n), 'utf8')).split('\n')) {
      if (!line.trim()) continue
      try {
        runs.push(JSON.parse(line) as Run)
      } catch {
        /* a half-written line: skip */
      }
    }
  }
  return runs
}

export async function write(dir: string, run: Run, sites: Site[], now: Date, links: { data: string; site?: string } = { data: '' }): Promise<void> {
  await mkdir(join(dir, 'days'), { recursive: true })
  await mkdir(join(dir, 'badges'), { recursive: true })
  await mkdir(join(dir, 'feeds'), { recursive: true })
  const day = run.at.slice(0, 10)
  const dayFile = join(dir, 'days', `${day}.jsonl`)
  const prev = (await readFile(dayFile, 'utf8').catch(() => '')) as string
  await writeFile(dayFile, `${prev}${JSON.stringify(run)}\n`)
  await writeFile(join(dir, 'latest.json'), `${JSON.stringify(run, null, 1)}\n`)
  await writeFile(join(dir, 'sites.json'), `${JSON.stringify(sites, null, 1)}\n`)
  const summary = summarize(await readRuns(dir), sites, now, run.run)
  await writeFile(join(dir, 'summary.json'), `${JSON.stringify(summary)}\n`)
  for (const s of summary.sites) await writeFile(join(dir, 'badges', `${slug(s.url)}.svg`), badgeSvg(s.up24, s.last ? s.last.up : null))

  const page = (s: string | null) => (links.site ? `${links.site}/#/${s ? `site/${s}` : ''}` : links.data)
  const updated = summary.generated
  await writeFile(
    join(dir, 'feeds', 'all.xml'),
    atom({ id: 'tag:watchtower,2026:all', title: 'Watchtower: ms.computer outages and downtime', self: `${links.data}/feeds/all.xml`, link: page(null), updated, entries: networkEntries(summary, page) }),
  )
  for (const s of summary.sites) {
    const id = slug(s.url)
    await writeFile(
      join(dir, 'feeds', `${id}.xml`),
      atom({ id: `tag:watchtower,2026:${id}`, title: `Watchtower: ${s.name}`, self: `${links.data}/feeds/${id}.xml`, link: page(id), updated, entries: siteEntries(summary, id, page) }),
    )
  }
}

// ── run ──────────────────────────────────────────────────────────────────────

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length))

/** The run log doubles as a receipt: every check, as it was measured. */
export function logLine(c: Check): string {
  return [
    c.up ? 'UP  ' : 'DOWN',
    pad(new URL(c.url).hostname, 44),
    pad(String(c.status ?? '—'), 4),
    pad(c.ttfb == null ? '—' : `${c.ttfb} ms`, 9),
    pad(c.upstream ?? '—', 8),
    pad(c.colo ?? '—', 4),
    c.error ?? (c.firstError ? `ok on 2nd try (1st: ${c.firstError})` : ''),
  ].join(' ')
}

async function main() {
  const args = process.argv.slice(2)
  const dir = args[args.indexOf('--out') + 1] && args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data'
  const config = (await readJson<Config>('config/sites.json')) ?? { sites: [], exclude: [] }
  const now = new Date()

  // tagged repos: looked up once an hour, kept in between
  const cachePath = join(dir, 'topic.json')
  const cache = await readJson<{ at: string; sites: Site[] }>(cachePath)
  let topic = cache?.sites ?? []
  if (!cache || now.getTime() - Date.parse(cache.at) > 55 * 60_000) {
    try {
      topic = await topicSites(githubGet(process.env.GH_TOKEN))
      await mkdir(dir, { recursive: true })
      await writeFile(cachePath, `${JSON.stringify({ at: now.toISOString(), sites: topic }, null, 1)}\n`)
      console.log(`Tagged repos with an ms.computer address: ${topic.length}`)
    } catch (e) {
      console.log(`Couldn’t search GitHub for tagged repos (${(e as Error).message}); using the last list.`)
    }
  }
  const sites = mergeSites(config, topic)

  const env = process.env
  const run: Run = {
    v: 1,
    at: now.toISOString(),
    run: env.GITHUB_RUN_ID
      ? { id: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT ?? 1), url: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` }
      : null,
    sha: env.GITHUB_SHA ?? null,
    control: undefined,
    checks: await checkAll(sites),
  }
  const control = await check(CONTROL)
  run.control = { ok: control.up, ms: control.ttfb, error: control.up ? null : (control.error ?? `HTTP ${control.status}`) }
  console.log(`Checked ${sites.length} sites at ${run.at}\n`)
  if (!control.up) console.log(`!! The control check (${CONTROL}) failed too: ${run.control.error}. This run says nothing about the sites and is left out of every number.\n`)
  for (const c of run.checks) console.log(logLine(c))
  const data = env.GITHUB_REPOSITORY ? `https://raw.githubusercontent.com/${env.GITHUB_REPOSITORY}/data` : dir
  await write(dir, run, sites, now, { data, site: config.site?.replace(/\/$/, '') || undefined })
  const down = run.checks.filter((c) => !c.up).length
  console.log(`\n${run.checks.length - down} up, ${down} down. Written to ${dir}/`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
