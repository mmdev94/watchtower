// Email alerts with no sign-up: one GitHub issue per site (and one for the
// whole network). When a site goes down or comes back, the probe comments on
// its issue, and GitHub emails everyone who pressed "Subscribe" on it.
//
//   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node --experimental-strip-types scripts/alerts.ts --out out
//
// State (which issue is which, and what was last announced) is kept in
// alerts.json next to the data, so a failed API call is retried next run.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minutesBetween } from '../src/lib/feed.ts'
import { slug, type Summary } from '../src/lib/model.ts'

export const NETWORK = 'network'
/** a site is announced as down after this many failed checks in a row (~10 min) */
export const CONFIRM = 2
const MARK = (key: string) => `<!-- watchtower-alerts:${key} -->`
const MAX_NEW_ISSUES = 10

export type AlertState = 'up' | 'down'
export interface Alerts {
  /** key (site slug or "network") → issue number */
  issues: Record<string, number>
  /** key → what was last announced */
  state: Record<string, AlertState>
}

export interface AlertEvent {
  key: string
  state: AlertState
  body: string
}

/** What each site (and the network) is now: down only once confirmed ("pending" before that), up as soon as a check is good. */
export function currentStates(summary: Summary): Record<string, AlertState | 'pending'> {
  const out: Record<string, AlertState | 'pending'> = {}
  for (const s of summary.sites) {
    if (!s.last) continue
    const open = s.incidents[0]?.end === null ? s.incidents[0] : null
    out[slug(s.url)] = s.last.up ? 'up' : open && open.checks >= CONFIRM ? 'down' : 'pending'
  }
  out[NETWORK] = summary.network.outage ? 'down' : 'up'
  return out
}

/**
 * The comments to post. A key seen for the first time is only recorded (no
 * comment), so adding a site never sends a burst of mail. A site that is down
 * but not yet confirmed keeps its last announced state.
 */
export function plan(summary: Summary, prev: Alerts, page: (slug: string | null) => string): AlertEvent[] {
  const now = currentStates(summary)
  const events: AlertEvent[] = []
  const runLink = summary.run ? ` · [the run that saw it](${summary.run.url})` : ''
  for (const [key, state] of Object.entries(now)) {
    const was = prev.state[key]
    if (state === 'pending' || was === undefined || was === state) continue
    if (key === NETWORK) {
      const o = summary.network.outage ?? summary.network.outages[0]
      events.push({
        key,
        state,
        body:
          state === 'down' && o
            ? `🔴 **ms.computer outage** — ${o.peak} of ${o.of} sites down since ${o.start.slice(0, 16).replace('T', ' ')} UTC. Many sites failing in the same check points at ms.computer itself, not the sites.\n\n[Live status](${page(null)})${runLink}`
            : `🟢 **Outage over**${o ? ` after ${minutesBetween(o.start, o.end, summary.generated)}` : ''} — most sites answer again.\n\n[Live status](${page(null)})${runLink}`,
      })
      continue
    }
    const s = summary.sites.find((x) => slug(x.url) === key)!
    const i = s.incidents[0]
    events.push({
      key,
      state,
      body:
        state === 'down'
          ? `🔴 **${s.name} is down** since ${i.start.slice(0, 16).replace('T', ' ')} UTC — ${i.reason}. Confirmed by ${i.checks} checks in a row.${i.network ? ' Many other sites are down too, so this is likely ms.computer itself.' : ''}\n\n[Site status](${page(key)})${runLink}`
          : `🟢 **${s.name} is back up**${i?.end ? ` after ${minutesBetween(i.start, i.end, summary.generated)}` : ''} — answered ${s.last?.status} in ${s.last?.ttfb} ms.\n\n[Site status](${page(key)})${runLink}`,
    })
  }
  return events
}

export function issueFor(key: string, summary: Summary, page: (slug: string | null) => string): { title: string; body: string } {
  const intro =
    '**Get an email when it goes down and when it’s back:** press **Subscribe** (on the right, or at the bottom on a phone). Unsubscribe the same way.\n\nWatchtower checks every 5 minutes from GitHub’s servers. A site counts as down after two checks in a row fail (each one tried twice, 5 seconds apart).'
  if (key === NETWORK)
    return {
      title: 'Alerts: ms.computer outages (many sites down at once)',
      body: `${MARK(key)}\nOne comment here each time many ms.computer sites fail in the same check, and again when it’s over.\n\n${intro}\n\n[Live status](${page(null)})`,
    }
  const s = summary.sites.find((x) => slug(x.url) === key)!
  return {
    title: `Alerts: ${s.name} (${new URL(s.url).hostname})`,
    body: `${MARK(key)}\nOne comment here each time **${s.name}** goes down, and again when it’s back.\n\n${intro}\n\n[Site status](${page(key)}) · [${s.url}](${s.url})`,
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

type Api = (method: string, path: string, body?: unknown) => Promise<unknown>

function github(token: string, repo: string): Api {
  return async (method, path, body) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'user-agent': 'Watchtower', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok && !(method === 'POST' && path === '/labels' && res.status === 422)) throw new Error(`GitHub answered ${res.status} to ${method} ${path}`)
    return res.status === 204 ? null : res.json()
  }
}

/** Finds the alert issues already made (by the marker in their body), creates missing ones, posts the events. */
export async function apply(api: Api, summary: Summary, prev: Alerts, page: (slug: string | null) => string, log = console.log): Promise<Alerts> {
  const next: Alerts = { issues: { ...prev.issues }, state: { ...prev.state } }
  const existing = (await api('GET', '/issues?labels=alerts&state=all&per_page=100')) as { number: number; body: string | null }[]
  for (const i of existing) {
    const key = /<!-- watchtower-alerts:([a-z0-9-]+) -->/.exec(i.body ?? '')?.[1]
    if (key) next.issues[key] = i.number
  }
  const keys = [NETWORK, ...summary.sites.map((s) => slug(s.url))]
  let made = 0
  for (const key of keys) {
    if (next.issues[key] || made >= MAX_NEW_ISSUES) continue
    if (made === 0) await api('POST', '/labels', { name: 'alerts', color: '8f63ff', description: 'Subscribe to get an email when a site goes down' })
    const created = (await api('POST', '/issues', { ...issueFor(key, summary, page), labels: ['alerts'] })) as { number: number }
    next.issues[key] = created.number
    made++
    log(`Made the alert issue for ${key}: #${created.number}`)
  }
  for (const e of plan(summary, prev, page)) {
    const n = next.issues[e.key]
    if (!n) continue // no issue yet: announce next run
    try {
      await api('POST', `/issues/${n}/comments`, { body: e.body })
      next.state[e.key] = e.state
      log(`Alert: ${e.key} is ${e.state} (#${n})`)
    } catch (err) {
      log(`Couldn’t post the alert for ${e.key}: ${(err as Error).message}. Trying again next run.`)
    }
  }
  // record keys seen for the first time, quietly
  for (const [key, state] of Object.entries(currentStates(summary))) if (next.state[key] === undefined && state !== 'pending') next.state[key] = state
  return next
}

async function main() {
  const args = process.argv.slice(2)
  const dir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'data'
  const { GH_TOKEN, GITHUB_REPOSITORY } = process.env
  if (!GH_TOKEN || !GITHUB_REPOSITORY) throw new Error('Needs GH_TOKEN and GITHUB_REPOSITORY')
  const summary = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')) as Summary
  const prev = (JSON.parse(await readFile(join(dir, 'alerts.json'), 'utf8').catch(() => 'null')) as Alerts | null) ?? { issues: {}, state: {} }
  const config = JSON.parse(await readFile('config/sites.json', 'utf8')) as { site?: string }
  const base = config.site || `https://github.com/${GITHUB_REPOSITORY}`
  const page = (s: string | null) => (config.site ? `${base}/#/${s ? `site/${s}` : ''}` : base)
  const next = await apply(github(GH_TOKEN, GITHUB_REPOSITORY), summary, prev, page)
  await writeFile(join(dir, 'alerts.json'), `${JSON.stringify(next, null, 1)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
