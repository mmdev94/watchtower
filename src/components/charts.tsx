import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { hourLabel, secs } from '../lib/data'
import type { Hour } from '../lib/model'

// ── hour bars: one cell per hour, coloured by how many checks were good ──────

export type Cell = 'good' | 'some' | 'bad' | 'none'
export function cellOf(h: Hour): Cell {
  if (!h) return 'none'
  const [n, up] = h
  if (up === n) return 'good'
  return up / n >= 0.5 ? 'some' : 'bad'
}
const CELL: Record<Cell, string> = { good: 'bg-good', some: 'bg-warn', bad: 'bg-bad', none: 'bg-empty' }
const CELL_WORDS: Record<Cell, string> = { good: 'All checks up', some: 'Some checks failed', bad: 'Mostly down', none: 'No check (GitHub didn’t run the schedule)' }

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function Tip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.max(0, Math.min(width - 220, x - 110))
  return (
    <div className="pointer-events-none absolute bottom-full z-20 mb-2 w-[220px] border border-line bg-white p-2.5 text-[12.5px] leading-snug shadow-[0_12px_30px_-12px_rgba(20,16,30,.35)]" style={{ left }}>
      {children}
    </div>
  )
}

/** The cells of the last `count` hours. Hover (or tap) a cell for its numbers. */
export function HourBars({ hours, h, count = h.length, height = 28, compact = false }: { hours: string[]; h: Hour[]; count?: number; height?: number; compact?: boolean }) {
  const hs = h.slice(-count)
  const labels = hours.slice(-count)
  const [ref, width] = useWidth<HTMLDivElement>()
  const [i, setI] = useState<number | null>(null)
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setI(Math.max(0, Math.min(hs.length - 1, Math.floor(((e.clientX - r.left) / r.width) * hs.length))))
  }
  const gap = width / hs.length > 6 ? 2 : 1
  const cur = i == null ? null : hs[i]
  return (
    <div className="relative">
      <div
        ref={ref}
        className="flex cursor-crosshair touch-none items-stretch"
        style={{ height, gap }}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setI(null)}
        role="img"
        aria-label={`${hs.filter((x) => cellOf(x) === 'good').length} of ${hs.length} hours with every check up`}
      >
        {hs.map((x, k) => (
          <span key={k} className={`min-w-0 flex-1 rounded-[2px] ${CELL[cellOf(x)]} ${i === k ? 'opacity-60' : ''}`} />
        ))}
      </div>
      {i != null && width > 0 && (
        <Tip x={((i + 0.5) / hs.length) * width} width={width}>
          <p className="font-semibold text-ink">{hourLabel(labels[i])}</p>
          <p className="mt-1 text-ink2">{CELL_WORDS[cellOf(cur)]}</p>
          {cur && (
            <p className="tabular mt-0.5 text-muted">
              {cur[1]} of {cur[0]} checks up · median {secs(cur[2])}
              {cur[1] > 0 && <> · {cur[3]} by miners</>}
            </p>
          )}
        </Tip>
      )}
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {(['good', 'some', 'bad', 'none'] as Cell[]).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-[2px] ${CELL[c]}`} />
              {c === 'good' ? 'all up' : c === 'some' ? 'some checks failed' : c === 'bad' ? 'mostly down' : 'no check'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── response time: one line, hourly medians ─────────────────────────────────

const niceMax = (v: number) => {
  const steps = [500, 1000, 1500, 2000, 3000, 4000, 5000, 8000, 10000, 15000]
  return steps.find((s) => s >= v) ?? Math.ceil(v / 5000) * 5000
}

export function LineChart({ hours, values, label }: { hours: string[]; values: (number | null)[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [i, setI] = useState<number | null>(null)
  const H = 200
  const pad = { l: 44, r: 12, t: 12, b: 26 }
  const known = values.filter((v): v is number => v != null)
  const max = niceMax(Math.max(1000, ...known))
  const w = Math.max(0, width - pad.l - pad.r)
  const x = (k: number) => pad.l + (values.length <= 1 ? 0 : (k / (values.length - 1)) * w)
  const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b)
  const ticks = [0, max / 2, max]

  // the line breaks where there's no data
  const segs: string[] = []
  let cur = ''
  values.forEach((v, k) => {
    if (v == null) {
      if (cur) segs.push(cur)
      cur = ''
    } else cur += `${cur ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`
  })
  if (cur) segs.push(cur)
  const areas = segs.map((d) => {
    const pts = d.slice(1).split(/[ML]/)
    const first = pts[0].split(',')[0]
    const last = pts.at(-1)!.split(',')[0]
    return `${d}L${last},${y(0)}L${first},${y(0)}Z`
  })

  // day ticks at local midnight
  const days = hours.map((iso, k) => ({ k, d: new Date(iso) })).filter(({ d }) => d.getHours() === 0)
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = Math.round(((e.clientX - r.left - pad.l) / w) * (values.length - 1))
    setI(Math.max(0, Math.min(values.length - 1, k)))
  }
  const lastK = values.findLastIndex((v) => v != null)

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={label} className="touch-none" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setI(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#c3c2b7' : '#e1e0d9'} strokeWidth="1" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#696d7e" className="tabular">
                {t === 0 ? '0' : secs(t)}
              </text>
            </g>
          ))}
          {days.map(({ k, d }) => (
            <text key={k} x={x(k)} y={H - 8} textAnchor="middle" fontSize="11" fill="#696d7e">
              {d.toLocaleDateString(undefined, { weekday: 'short' })}
            </text>
          ))}
          {areas.map((d, k) => (
            <path key={k} d={d} fill="#8f63ff" opacity="0.1" />
          ))}
          {segs.map((d, k) => (
            <path key={k} d={d} fill="none" stroke="#8f63ff" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {lastK >= 0 && i == null && (
            <>
              <circle cx={x(lastK)} cy={y(values[lastK]!)} r="5" fill="#8f63ff" stroke="#fff" strokeWidth="2" />
              <text x={x(lastK) - 10} y={y(values[lastK]!) - 12} textAnchor="end" fontSize="12" fontWeight="600" fill="#16161a" stroke="#fff" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
                {secs(values[lastK])}
              </text>
            </>
          )}
          {i != null && (
            <>
              <line x1={x(i)} x2={x(i)} y1={pad.t} y2={y(0)} stroke="#c3c2b7" strokeWidth="1" />
              {values[i] != null && <circle cx={x(i)} cy={y(values[i]!)} r="5" fill="#8f63ff" stroke="#fff" strokeWidth="2" />}
            </>
          )}
        </svg>
      )}
      {i != null && (
        <Tip x={x(i)} width={width}>
          <p className="font-semibold text-ink">{hourLabel(hours[i])}</p>
          <p className="tabular mt-1 text-ink2">{values[i] == null ? 'No answers to time' : `Median ${secs(values[i])}`}</p>
        </Tip>
      )}
    </div>
  )
}

/** A check's timeline: finding the address → connecting → secure handshake → waiting for the server. */
export function Phases({ dns, connect, tls, ttfb }: { dns: number | null; connect: number | null; tls: number | null; ttfb: number | null }) {
  if (ttfb == null) return null
  const parts = [
    { label: 'Find address', ms: dns ?? 0, c: '#c9b8ff' },
    { label: 'Connect', ms: connect != null && dns != null ? connect - dns : 0, c: '#a98bff' },
    { label: 'Secure handshake', ms: tls != null && connect != null ? tls - connect : 0, c: '#8f63ff' },
    { label: 'Server answers', ms: tls != null ? ttfb - tls : ttfb, c: '#6f2a85' },
  ].filter((p) => p.ms > 0)
  return (
    <div>
      <div className="flex h-3 gap-[2px]">
        {parts.map((p) => (
          <span key={p.label} title={`${p.label}: ${secs(p.ms)}`} className="first:rounded-l-[3px] last:rounded-r-[3px]" style={{ flex: p.ms, background: p.c }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {parts.map((p) => (
          <span key={p.label} className="tabular inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: p.c }} />
            {p.label} <span className="text-ink2">{secs(p.ms)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
