// Push → live: how long a `git push` takes to reach ms.computer, for every
// repo that deploys with Shipyard's workflow. Both ends are public GitHub
// records: the push-triggered run's creation time (seconds after the push),
// and the GitHub Deployment the workflow records the moment ms.computer
// reports the new version live. Rollbacks and manual runs aren't pushes and
// are left out. Runs hourly; the result is signed with the rest of the data.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RunRec {
  id: number
  head_sha: string
  created_at: string
  run_started_at?: string
  conclusion: string | null
  html_url: string
}
export interface DeploymentRec {
  sha: string
  created_at: string
}
export interface Deploy {
  sha: string
  pushed: string
  live: string
  /** push → live, seconds */
  total: number
  /** of which waiting for a GitHub runner */
  queued: number
  run: string
}
export interface RepoDeploys {
  repo: string
  mode: 'static' | 'dynamic' | null
  deploys: Deploy[]
}
export interface DeploysFile {
  v: 1
  generated: string
  repos: RepoDeploys[]
  all: { count: number; repos: number; median: number | null; p90: number | null; fastest: number | null; slowest: number | null; medianQueued: number | null }
}

export const SHIPYARD_REPOS = ['mmdev94/shipyard', 'mmdev94/shipyard-test']
/** a deploy can't take longer than the workflow's 30-minute limit; anything else is a mismatched record */
const MAX = 45 * 60

export function pctl(v: number[], p: number): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}

/** Matches each successful push run with the deployment recorded for its commit. */
export function pairDeploys(runs: RunRec[], deployments: DeploymentRec[]): Deploy[] {
  const out: Deploy[] = []
  for (const r of runs) {
    if (r.conclusion !== 'success') continue
    const pushed = Date.parse(r.created_at)
    // the first record for this commit made after the run began
    const d = deployments.filter((x) => x.sha === r.head_sha && Date.parse(x.created_at) >= pushed).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]
    if (!d) continue
    const total = Math.round((Date.parse(d.created_at) - pushed) / 1000)
    if (total < 0 || total > MAX) continue
    const queued = r.run_started_at ? Math.max(0, Math.round((Date.parse(r.run_started_at) - pushed) / 1000)) : 0
    out.push({ sha: r.head_sha.slice(0, 7), pushed: r.created_at, live: d.created_at, total, queued, run: r.html_url })
  }
  return out
}

export function summarizeDeploys(repos: RepoDeploys[], now: Date): DeploysFile {
  const all = repos.flatMap((r) => r.deploys)
  const t = all.map((d) => d.total)
  return {
    v: 1,
    generated: now.toISOString(),
    repos,
    all: { count: all.length, repos: repos.filter((r) => r.deploys.length).length, median: pctl(t, 50), p90: pctl(t, 90), fastest: t.length ? Math.min(...t) : null, slowest: t.length ? Math.max(...t) : null, medianQueued: pctl(all.map((d) => d.queued), 50) },
  }
}

type Get = <T>(path: string) => Promise<T | null>

export async function measureRepo(get: Get, repo: string): Promise<RepoDeploys | null> {
  const wf = await get<{ content?: string }>(`/repos/${repo}/contents/.github/workflows/ms-computer.yml`)
  const yaml = wf?.content ? Buffer.from(wf.content, 'base64').toString('utf8') : ''
  if (!/^# shipyard-workflow: \d+/m.test(yaml)) return null // not deployed by Shipyard
  const mode = (/"mode":"(static|dynamic)"/.exec(yaml)?.[1] as 'static' | 'dynamic' | undefined) ?? null
  const runs = await get<{ workflow_runs: RunRec[] }>(`/repos/${repo}/actions/workflows/ms-computer.yml/runs?event=push&status=completed&per_page=30`)
  const deployments = await get<DeploymentRec[]>(`/repos/${repo}/deployments?environment=ms-computer&per_page=50`)
  return { repo, mode, deploys: pairDeploys(runs?.workflow_runs ?? [], deployments ?? []) }
}

async function main() {
  const args = process.argv.slice(2)
  const dir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data'
  const path = join(dir, 'deploys.json')
  const now = new Date()
  try {
    const prev = JSON.parse(await readFile(path, 'utf8')) as DeploysFile
    if (now.getTime() - Date.parse(prev.generated) < 55 * 60_000 && !args.includes('--now')) {
      console.log(`Push → live measured at ${prev.generated}; next time in an hour.`)
      return
    }
  } catch {
    /* first time */
  }
  const token = process.env.GH_TOKEN
  const get: Get = async <T>(p: string) => {
    const res = await fetch(`https://api.github.com${p}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Shipyard-probe/1.0', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
    return res.ok ? ((await res.json()) as T) : null
  }
  const sites = JSON.parse(await readFile(join(dir, 'sites.json'), 'utf8').catch(() => '[]')) as { repo?: string | null }[]
  const repos = [...new Set([...SHIPYARD_REPOS, ...sites.map((s) => s.repo).filter((r): r is string => Boolean(r))])]
  const measured: RepoDeploys[] = []
  for (const repo of repos) {
    const r = await measureRepo(get, repo).catch(() => null)
    if (r) measured.push(r)
  }
  const file = summarizeDeploys(measured, now)
  await writeFile(path, `${JSON.stringify(file)}\n`)
  console.log(`Push → live: ${file.all.count} deploys in ${file.all.repos} repos; median ${file.all.median}s, 90th percentile ${file.all.p90}s.`)
  for (const r of measured) console.log(`  ${r.repo}: ${r.deploys.map((d) => `${d.sha} ${d.total}s`).join(', ') || 'no push deploys on record'}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
