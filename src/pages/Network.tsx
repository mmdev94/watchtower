import { useMemo, useState } from 'react'
import { HourBars, LineChart } from '../components/charts'
import { BrowserTest, VerifyData } from '../components/proof'
import { Receipt, ServedBy, Stat, StatusPill, statusOf, type Status } from '../components/ui'
import { ago, duration, pct, PROBE_RUNS, secs, useSummary, when, type Loaded } from '../lib/data'
import { percentile, slug, type SiteSummary } from '../lib/model'
import { href } from '../lib/route'

const ORDER: Record<Status, number> = { down: 0, unknown: 1, up: 2 }

function Hero({ data }: { data: Loaded }) {
  const { summary } = data
  const statuses = summary.sites.map((s) => statusOf(s, summary.generated))
  const up = statuses.filter((s) => s === 'up').length
  const down = statuses.filter((s) => s === 'down').length
  const stale = Date.now() - Date.parse(summary.generated) > 20 * 60_000
  const good = summary.sites.flatMap((s) => (s.last?.up ? [s.last] : []))
  const miners = good.filter((c) => c.upstream === 'replica').length
  const ttfb = percentile(summary.sites.map((s) => s.ttfb50).filter((v): v is number => v != null), 50)
  const up24 = summary.sites.filter((s) => s.up24 != null)
  const avgUp = up24.length ? up24.reduce((a, s) => a + s.up24!, 0) / up24.length : null

  return (
    <section className="border-b border-line bg-white">
      <div className="mx-auto max-w-shell px-5 pb-12 pt-14 md:px-8 md:pt-20">
        <span className="eyebrow">Live · checked every 5 minutes</span>
        <h1 className="font-display mt-4 max-w-[18ch] text-[clamp(2.4rem,6vw,4.4rem)] font-semibold leading-[1.0] tracking-[-0.04em]">
          {down === 0 ? (
            <>All {up} sites are up.</>
          ) : (
            <>
              {up} of {summary.sites.length} sites are up. <span className="text-badText">{down} down.</span>
            </>
          )}
        </h1>
        <p className="mt-5 max-w-[62ch] text-lg leading-relaxed text-muted">
          Watchtower checks ms.computer sites from GitHub’s servers, in public runs anyone can open. Every result is signed, kept in a public
          repo, and linked from the number it made.
        </p>
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink2">
          <span>
            Last check <strong>{ago(summary.generated)}</strong> ({when(summary.generated)})
          </span>
          <span className="text-line">|</span>
          <Receipt run={summary.run}>{summary.run ? 'open the run that measured it ↗' : undefined}</Receipt>
        </p>
        {stale && (
          <p className="mt-3 max-w-[70ch] border-l-2 border-warn bg-[#fff8e6] px-3 py-2 text-[14px] text-ink2">
            GitHub hasn’t run the check for a while — its scheduler sometimes runs late. Missed checks show as gaps, never as “down”.{' '}
            <a href={PROBE_RUNS} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">See the runs ↗</a>
          </p>
        )}
        <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Up right now" value={`${up} / ${summary.sites.length}`} tone={down ? 'bad' : undefined} note={down ? `${down} answering with errors` : 'every site answered'} />
          <Stat label="Average uptime, 24 h" value={pct(avgUp)} note="share of checks that got a good answer" />
          <Stat label="Typical response" value={secs(ttfb)} note="time to first byte, median of the sites, 24 h" />
          <Stat label="Served by miners" value={good.length ? `${miners} / ${good.length}` : '—'} note="up sites whose last answer came from a miner’s copy" />
        </div>
      </div>
    </section>
  )
}

function Row({ s, generated, hours }: { s: SiteSummary; generated: string; hours: string[] }) {
  const status = statusOf(s, generated)
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1.6fr)_80px_80px_110px] md:px-5">
      <div className="min-w-0">
        <a href={href.site(slug(s.url))} className="font-semibold text-ink hover:text-accent">{s.name}</a>
        <p className="font-mono truncate text-[12px] text-muted">{new URL(s.url).hostname}</p>
      </div>
      <StatusPill status={status} className="justify-self-end md:justify-self-start" />
      <div className="col-span-2 md:col-span-1">
        <HourBars hours={hours} h={s.h} count={24} height={22} compact />
      </div>
      <p className="tabular text-[14px] text-ink2 md:text-right">
        <span className="text-muted md:hidden">24 h uptime </span>
        {pct(s.up24)}
      </p>
      <p className="tabular justify-self-end text-[14px] text-ink2 md:text-right">
        <span className="text-muted md:hidden">median </span>
        {secs(s.ttfb50)}
      </p>
      <p className="col-span-2 text-[13px] text-ink2 md:col-span-1 md:text-right">
        <span className="text-muted md:hidden">Served by </span>
        {status === 'down' ? <span className="text-badText">{s.last?.status ? `HTTP ${s.last.status}` : (s.last?.error ?? '—')}</span> : <ServedBy upstream={s.last?.upstream} up={Boolean(s.last?.up)} />}
      </p>
    </li>
  )
}

function Sites({ data }: { data: Loaded }) {
  const { summary } = data
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return summary.sites
      .filter((s) => !t || `${s.name} ${s.url} ${s.repo ?? ''}`.toLowerCase().includes(t))
      .sort((a, b) => ORDER[statusOf(a, summary.generated)] - ORDER[statusOf(b, summary.generated)] || a.name.localeCompare(b.name))
  }, [summary, q])
  return (
    <section className="mx-auto max-w-shell px-5 pt-14 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="eyebrow">Every site</span>
          <h2 className="font-display mt-3 text-[clamp(1.7rem,3.4vw,2.4rem)] font-semibold tracking-[-0.03em]">The last 24 hours, hour by hour</h2>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a site…" aria-label="Find a site" className="w-full max-w-xs border border-line bg-white px-4 py-2.5 text-[15px] outline-none focus:border-accent" />
      </div>
      <div className="mt-6 border border-line bg-white">
        <div className="hidden grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1.6fr)_80px_80px_110px] gap-x-4 border-b border-line bg-bg2 px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted md:grid">
          <span>Site</span>
          <span>Now</span>
          <span>Last 24 h (hover an hour)</span>
          <span className="text-right">Uptime</span>
          <span className="text-right">Median</span>
          <span className="text-right">Served by</span>
        </div>
        <ul className="divide-y divide-line">
          {list.map((s) => (
            <Row key={s.url} s={s} generated={summary.generated} hours={summary.hours} />
          ))}
        </ul>
        {list.length === 0 && <p className="p-5 text-muted">Nothing matches “{q}”.</p>}
      </div>
      <p className="mt-3 text-[13px] text-muted">
        Down means two tries, 5 seconds apart, both failed. Hours with no check (GitHub’s scheduler skipped them) are grey, not red.{' '}
        <a href={href.how('add')} className="text-accent underline underline-offset-2">Add your site</a>
      </p>
    </section>
  )
}

function Trend({ data }: { data: Loaded }) {
  const { summary } = data
  const values = summary.hours.map((_, i) => percentile(summary.sites.map((s) => s.h[i]?.[2]).filter((v): v is number => v != null), 50))
  const upShare = summary.hours.map((_, i) => {
    const hs = summary.sites.map((s) => s.h[i]).filter((h) => h)
    return hs.length ? hs.reduce((a, h) => a + h![1], 0) / hs.reduce((a, h) => a + h![0], 0) : null
  })
  const measured = upShare.filter((v) => v != null).length
  return (
    <section className="mx-auto max-w-shell px-5 pt-16 md:px-8">
      <span className="eyebrow">The week</span>
      <h2 className="font-display mt-3 text-[clamp(1.7rem,3.4vw,2.4rem)] font-semibold tracking-[-0.03em]">How fast ms.computer answers</h2>
      <p className="mt-2 max-w-[62ch] text-muted">
        Typical time to first byte across all sites, hour by hour for 7 days{measured < 24 ? ` — Watchtower started ${measured === 1 ? 'an hour' : `${measured} hours`} ago, so the line is short for now` : ''}.
      </p>
      <div className="mt-6 border border-line bg-white p-4 md:p-6">
        <LineChart hours={summary.hours} values={values} label="Median time to first byte across all sites, per hour, last 7 days" />
      </div>
    </section>
  )
}

function Incidents({ data }: { data: Loaded }) {
  const all = data.summary.sites
    .flatMap((s) => s.incidents.map((i) => ({ ...i, site: s })))
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 12)
  return (
    <section className="mx-auto max-w-shell px-5 pt-16 md:px-8">
      <span className="eyebrow">Incidents</span>
      <h2 className="font-display mt-3 text-[clamp(1.7rem,3.4vw,2.4rem)] font-semibold tracking-[-0.03em]">Recent downtime</h2>
      {all.length === 0 ? (
        <p className="mt-4 text-muted">No downtime in the last 7 days.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border border-line bg-white">
          {all.map((i) => (
            <li key={`${i.site.url}${i.start}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5">
              <span>
                <a href={href.site(slug(i.site.url))} className="font-semibold hover:text-accent">{i.site.name}</a>{' '}
                <span className="text-[14px] text-ink2">— {i.reason}</span>
              </span>
              <span className="tabular text-[13px] text-muted">
                {when(i.start)} · {i.end ? `down for ${duration(i.start, i.end)}` : <strong className="text-badText">still down · {duration(i.start, null)}</strong>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Proof({ data }: { data: Loaded }) {
  const urls = data.summary.sites.map((s) => ({ url: s.url, name: s.name }))
  return (
    <section className="mx-auto max-w-shell px-5 pt-16 md:px-8">
      <span className="eyebrow">Don’t take our word for it</span>
      <h2 className="font-display mt-3 text-[clamp(1.7rem,3.4vw,2.4rem)] font-semibold tracking-[-0.03em]">Check the checker</h2>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <VerifyData data={data} />
        <BrowserTest urls={urls} />
      </div>
      <p className="mt-4 text-[14px] text-muted">
        More: <a href={href.how()} className="text-accent underline underline-offset-2">how every number is measured</a>, the raw data, and how to run your own Watchtower.
      </p>
    </section>
  )
}

function Cta() {
  return (
    <section className="mx-auto max-w-shell px-5 pt-16 md:px-8">
      <div className="grid gap-6 bg-ink p-8 text-white md:grid-cols-[1fr_auto] md:items-center md:p-10">
        <div>
          <p className="font-display text-2xl font-semibold tracking-[-0.02em]">Have a site on ms.computer?</p>
          <p className="mt-2 max-w-[56ch] text-[#c9cbd3]">
            Add the topic <code className="font-mono text-white">ms-computer</code> to its GitHub repo and Watchtower starts watching it within the hour — with an
            uptime badge for your README.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={href.how('add')} className="bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-accentSoft">Add your site</a>
          <a href={href.how('run')} className="border border-[#4a4c57] px-4 py-2.5 text-sm font-semibold hover:border-white">Run your own Watchtower</a>
        </div>
      </div>
    </section>
  )
}

export function Network() {
  const { data, error } = useSummary()
  if (!data) return <Loading error={error} />
  return (
    <>
      <Hero data={data} />
      <Sites data={data} />
      <Trend data={data} />
      <Incidents data={data} />
      <Proof data={data} />
      <Cta />
    </>
  )
}

export function Loading({ error }: { error: string }) {
  return (
    <section className="mx-auto max-w-shell px-5 py-24 md:px-8">
      {error ? (
        <p className="border border-[#f1c2bd] bg-[#fff6f5] p-5 text-badText">{error}</p>
      ) : (
        <p className="text-muted">Reading the latest checks from GitHub…</p>
      )}
    </section>
  )
}
