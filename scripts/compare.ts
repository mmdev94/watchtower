// Side by side: the same page, built from the same commit, served by
// ms.computer and by another host (GitHub Pages), measured in the same run
// from the same place. Each run takes three samples of each, alternating
// which host goes first; every sample is a fresh connection (DNS, connect,
// TLS included), exactly like the uptime checks. Samples are kept per day in
// compare/days/*.jsonl; compare.json summarises the last 24 hours and 7 days.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './probe.ts'
import type { Check } from '../src/lib/model.ts'

export interface Pair {
  id: string
  name: string
  repo?: string
  ms: string
  other: { host: string; url: string }
}
export interface Sample {
  host: 'ms' | 'other'
  ttfb: number | null
  wait: number | null
  total: number | null
  status: number | null
  up: boolean
  upstream: string | null
}
export interface CompareRun {
  at: string
  run: string | null
  pairs: { id: string; samples: Sample[] }[]
}
export interface HostStats {
  url: string
  host: string
  samples: number
  failed: number
  ttfb50: number | null
  ttfb90: number | null
  wait50: number | null
  total50: number | null
}
export interface PairSummary {
  id: string
  name: string
  repo?: string
  ms: HostStats
  other: HostStats
  /** share of runs where ms.computer's median time to first byte was lower */
  msFaster: number | null
  runs: number
  /** hourly medians of time to first byte, oldest first, 24 entries */
  hours: { ms: number | null; other: number | null }[]
}
export interface CompareFile {
  v: 1
  generated: string
  window24: PairSummary[]
  window7d: PairSummary[]
}

const ROUNDS = 3
const HOUR = 3_600_000

export function pctl(v: number[], p: number): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}

const lite = (host: Sample['host'], c: Check): Sample => ({ host, ttfb: c.ttfb, wait: c.wait, total: c.total, status: c.status, up: c.up, upstream: c.upstream })

/** One run: three rounds per pair, alternating which host is measured first. */
export async function measurePairs(pairs: Pair[], m: (url: string) => Promise<Check> = (u) => measure(u)): Promise<CompareRun['pairs']> {
  const out: CompareRun['pairs'] = []
  for (const p of pairs) {
    const samples: Sample[] = []
    for (let i = 0; i < ROUNDS; i++) {
      const order: Sample['host'][] = i % 2 === 0 ? ['ms', 'other'] : ['other', 'ms']
      for (const h of order) samples.push(lite(h, await m(h === 'ms' ? p.ms : p.other.url)))
    }
    out.push({ id: p.id, samples })
  }
  return out
}

function stats(url: string, host: string, s: Sample[]): HostStats {
  const ok = s.filter((x) => x.up && x.ttfb != null)
  const v = (k: 'ttfb' | 'wait' | 'total') => ok.map((x) => x[k]).filter((n): n is number => n != null)
  return { url, host, samples: s.length, failed: s.length - ok.length, ttfb50: pctl(v('ttfb'), 50), ttfb90: pctl(v('ttfb'), 90), wait50: pctl(v('wait'), 50), total50: pctl(v('total'), 50) }
}

export function summarizePair(p: Pair, runs: CompareRun[], now: Date, windowMs: number): PairSummary {
  const from = now.getTime() - windowMs
  const mine = runs.filter((r) => Date.parse(r.at) >= from).map((r) => ({ at: Date.parse(r.at), s: r.pairs.find((x) => x.id === p.id)?.samples ?? [] })).filter((r) => r.s.length)
  const all = mine.flatMap((r) => r.s)
  const med = (s: Sample[], h: Sample['host']) => pctl(s.filter((x) => x.host === h && x.up && x.ttfb != null).map((x) => x.ttfb!), 50)
  const decided = mine.map((r) => [med(r.s, 'ms'), med(r.s, 'other')]).filter(([a, b]) => a != null && b != null) as [number, number][]
  const hours = Array.from({ length: 24 }, (_, i) => {
    const start = now.getTime() - (24 - i) * HOUR
    const s = mine.filter((r) => r.at >= start && r.at < start + HOUR).flatMap((r) => r.s)
    return { ms: med(s, 'ms'), other: med(s, 'other') }
  })
  return {
    id: p.id,
    name: p.name,
    ...(p.repo ? { repo: p.repo } : {}),
    ms: stats(p.ms, 'ms.computer', all.filter((x) => x.host === 'ms')),
    other: stats(p.other.url, p.other.host, all.filter((x) => x.host === 'other')),
    msFaster: decided.length ? decided.filter(([a, b]) => a < b).length / decided.length : null,
    runs: mine.length,
    hours,
  }
}

async function readRuns(dir: string): Promise<CompareRun[]> {
  const days = join(dir, 'compare', 'days')
  let names: string[] = []
  try {
    names = (await readdir(days)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().slice(-8)
  } catch {
    return []
  }
  const out: CompareRun[] = []
  for (const n of names) for (const line of (await readFile(join(days, n), 'utf8')).split('\n')) if (line.trim()) out.push(JSON.parse(line) as CompareRun)
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const dir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data'
  const cfg = JSON.parse(await readFile('config/compare.json', 'utf8')) as { pairs: Pair[] }
  const now = new Date()
  const env = process.env
  const run: CompareRun = {
    at: now.toISOString(),
    run: env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
    pairs: await measurePairs(cfg.pairs),
  }
  const days = join(dir, 'compare', 'days')
  await mkdir(days, { recursive: true })
  const dayFile = join(days, `${run.at.slice(0, 10)}.jsonl`)
  const prev = await readFile(dayFile, 'utf8').catch(() => '')
  await writeFile(dayFile, `${prev}${JSON.stringify(run)}\n`)
  const runs = await readRuns(dir)
  const file: CompareFile = {
    v: 1,
    generated: now.toISOString(),
    window24: cfg.pairs.map((p) => summarizePair(p, runs, now, 24 * HOUR)),
    window7d: cfg.pairs.map((p) => summarizePair(p, runs, now, 7 * 24 * HOUR)),
  }
  await writeFile(join(dir, 'compare.json'), `${JSON.stringify(file)}\n`)
  for (const p of run.pairs) {
    console.log(`${p.id}:`)
    for (const s of p.samples) console.log(`  ${s.host === 'ms' ? 'ms.computer ' : 'other host  '} ${s.up ? `${s.ttfb} ms to first byte (server ${s.wait} ms)` : `failed (${s.status ?? 'no answer'})`}`)
  }
  const s = file.window24[0]
  if (s) console.log(`\n24 h: ms.computer median ${s.ms.ttfb50} ms, ${s.other.host} ${s.other.ttfb50} ms, over ${s.runs} runs.`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
