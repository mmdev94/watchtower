import type { ReactNode } from 'react'
import { PROBE_RUNS, REPO } from '../lib/data'
import type { SiteSummary } from '../lib/model'
import { href } from '../lib/route'

export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span className={`relative grid place-items-center rounded-lg bg-ink ${className}`}>
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none" aria-hidden>
        <path d="M12 27l2.2-13h3.6L20 27z" fill="#8f63ff" />
        <path d="M11 14h10M13 10.5h6l1 3.5h-8z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="16" cy="7" r="1.6" fill="#0ca30c" />
      </svg>
    </span>
  )
}

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-shell items-center justify-between gap-4 px-5 py-3 md:px-8">
        <a href={href.home} className="flex items-center gap-2.5">
          <Mark />
          <span className="leading-none">
            <span className="font-display block text-[17px] font-bold tracking-[-0.01em]">Watchtower</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">for ms.computer</span>
          </span>
        </a>
        <nav className="flex items-center gap-1 text-[14px] font-semibold text-ink2">
          <a href={href.home} className="px-3 py-2 hover:text-accent">Sites</a>
          <a href={href.how()} className="px-3 py-2 hover:text-accent"><span className="sm:hidden">How</span><span className="hidden sm:inline">How it’s measured</span></a>
          <a href={`https://github.com/${REPO}`} target="_blank" rel="noopener" className="hidden px-3 py-2 hover:text-accent sm:block">GitHub ↗</a>
        </nav>
      </div>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line bg-white">
      <div className="mx-auto grid max-w-shell gap-8 px-5 py-10 text-[14px] text-muted md:grid-cols-[1fr_auto] md:px-8">
        <div>
          <p className="font-semibold text-ink">Watchtower is open source and runs on ms.computer.</p>
          <p className="mt-1 max-w-[60ch]">
            A community tool, not an official ms.computer product. The checks run in{' '}
            <a className="text-accent underline underline-offset-2" href={PROBE_RUNS} target="_blank" rel="noopener">public GitHub runs</a>, and
            the data they save is public too.
          </p>
        </div>
        <p className="font-mono text-[12px]">
          site build {__COMMIT__} · <a className="hover:text-accent" href={`https://github.com/${REPO}`} target="_blank" rel="noopener">{REPO}</a>
        </p>
      </div>
    </footer>
  )
}

export type Status = 'up' | 'down' | 'unknown'

/** Up / down from the latest check; "unknown" when there's no check in the last 30 minutes. */
export function statusOf(s: SiteSummary, generated: string): Status {
  if (!s.last) return 'unknown'
  if (Date.parse(generated) - Date.parse(s.last.at) > 30 * 60_000) return 'unknown'
  return s.last.up ? 'up' : 'down'
}

const STATUS: Record<Status, { label: string; dot: string; text: string }> = {
  up: { label: 'Up', dot: 'bg-good', text: 'text-goodText' },
  down: { label: 'Down', dot: 'bg-bad', text: 'text-badText' },
  unknown: { label: 'No recent check', dot: 'bg-muted', text: 'text-muted' },
}

export function StatusPill({ status, className = '' }: { status: Status; className?: string }) {
  const s = STATUS[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${s.text} ${className}`}>
      <span className="relative inline-flex h-2.5 w-2.5">
        {status !== 'unknown' && <span className={`beacon absolute inset-0 rounded-full ${s.dot}`} />}
        <span className={`relative h-2.5 w-2.5 rounded-full ${s.dot}`} />
      </span>
      {s.label}
    </span>
  )
}

export function ServedBy({ upstream, up }: { upstream: string | null | undefined; up: boolean }) {
  if (!up) return <span className="text-muted">—</span>
  if (upstream === 'replica') return <span title="ms.computer said a miner’s copy of the site answered (x-ms-edge-upstream: replica)">miners</span>
  if (upstream === 'origin')
    return <span title="ms.computer said its own temporary copy answered (x-ms-edge-upstream: origin) — usual right after a deploy, before miners take over">ms.computer origin</span>
  return <span className="text-muted" title="the answer didn’t say">not said</span>
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="border border-line bg-white p-5">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <p className={`font-display tabular mt-1 text-[2rem] font-semibold leading-tight tracking-[-0.02em] ${tone === 'bad' ? 'text-badText' : 'text-ink'}`}>{value}</p>
      {note && <p className="mt-1 text-[13px] leading-snug text-muted">{note}</p>}
    </div>
  )
}

export function Receipt({ run, children }: { run: { url: string } | null; children?: ReactNode }) {
  if (!run) return <span className="text-muted">{children ?? 'measured locally (not a public run)'}</span>
  return (
    <a href={run.url} target="_blank" rel="noopener" className="font-mono text-accent underline underline-offset-2 hover:text-accent2">
      {children ?? 'see the run ↗'}
    </a>
  )
}
