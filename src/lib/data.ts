// Loading the data the probe commits to the `data` branch, straight from
// GitHub's raw file host. Nothing is cached by this site: the bytes the page
// shows are the bytes in the repo, and "Verify" hashes exactly those bytes.
import { useEffect, useState } from 'react'
import type { Summary } from './model.ts'

export const REPO = __REPO__
export const DATA = import.meta.env.VITE_DATA ?? `https://raw.githubusercontent.com/${REPO}/data`
export const DATA_TREE = `https://github.com/${REPO}/tree/data`
export const PROBE_RUNS = `https://github.com/${REPO}/actions/workflows/probe.yml`

export interface Loaded {
  summary: Summary
  /** the exact text that was downloaded, for hashing */
  raw: string
  loadedAt: number
}

export async function loadSummary(fetchImpl: typeof fetch = fetch): Promise<Loaded> {
  const res = await fetchImpl(`${DATA}/summary.json`, { cache: 'no-cache' })
  if (res.status === 404) throw new Error('No data yet: the first check hasn’t been saved.')
  if (!res.ok) throw new Error(`GitHub answered ${res.status} when asked for the data.`)
  const raw = await res.text()
  return { summary: JSON.parse(raw) as Summary, raw, loadedAt: Date.now() }
}

type State = { data: Loaded | null; error: string; refreshing: boolean }

let shared: State = { data: null, error: '', refreshing: false }
const subs = new Set<(s: State) => void>()
const set = (s: Partial<State>) => {
  shared = { ...shared, ...s }
  subs.forEach((f) => f(shared))
}
let inflight: Promise<void> | null = null
export function refresh(): Promise<void> {
  if (inflight) return inflight
  set({ refreshing: true })
  inflight = loadSummary()
    .then((data) => set({ data, error: '' }))
    .catch((e) => set({ error: (e as Error).message }))
    .finally(() => {
      set({ refreshing: false })
      inflight = null
    })
  return inflight
}

/** The summary, shared by every page, reloaded every 2 minutes while the tab is open. */
export function useSummary(): State & { refresh: () => Promise<void> } {
  const [s, setS] = useState(shared)
  useEffect(() => {
    subs.add(setS)
    if (!shared.data && !inflight) refresh()
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 120_000)
    return () => {
      subs.delete(setS)
      clearInterval(t)
    }
  }, [])
  return { ...s, refresh }
}

// ── formatting ───────────────────────────────────────────────────────────────

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export function duration(fromIso: string, toIso: string | null, now = Date.now()): string {
  const m = Math.max(1, Math.round(((toIso ? Date.parse(toIso) : now) - Date.parse(fromIso)) / 60000))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
  return `${Math.round(h / 24)} days`
}

export const secs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`)

export function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v >= 0.9995) return '100%'
  return `${(Math.floor(v * 1000) / 10).toFixed(1)}%`
}

export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const hourLabel = (iso: string) => {
  const d = new Date(iso)
  const end = new Date(d.getTime() + 3_600_000)
  const t = (x: Date) => x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${t(d)}–${t(end)}`
}

// ── alerts: which GitHub issue to subscribe to for each site ─────────────────

export interface AlertsFile {
  issues: Record<string, number>
}
let alertsP: Promise<AlertsFile | null> | null = null
export const loadAlerts = () =>
  (alertsP ??= fetch(`${DATA}/alerts.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<AlertsFile>) : null))
    .catch(() => null))

export function useAlerts(): AlertsFile | null {
  const [a, setA] = useState<AlertsFile | null>(null)
  useEffect(() => {
    let alive = true
    loadAlerts().then((x) => alive && setA(x))
    return () => {
      alive = false
    }
  }, [])
  return a
}

export const issueUrl = (n: number) => `https://github.com/${REPO}/issues/${n}`
export const feedUrl = (slug: string | null) => `${DATA}/feeds/${slug ?? 'all'}.xml`
