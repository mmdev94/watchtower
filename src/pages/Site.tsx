import { HourBars, LineChart, Phases } from '../components/charts'
import { BrowserTest, CodeLine } from '../components/proof'
import { Receipt, ServedBy, Stat, StatusPill, statusOf } from '../components/ui'
import { DATA, DATA_TREE, duration, pct, secs, useSummary, when } from '../lib/data'
import { reasonOf, slug as slugOf } from '../lib/model'
import { href } from '../lib/route'
import { Loading } from './Network'

const SITE_URL = typeof window === 'undefined' ? '' : `${window.location.origin}/`

export function SitePage({ slug }: { slug: string }) {
  const { data, error } = useSummary()
  if (!data) return <Loading error={error} />
  const { summary } = data
  const s = summary.sites.find((x) => slugOf(x.url) === slug)
  if (!s)
    return (
      <section className="mx-auto max-w-shell px-5 py-24 md:px-8">
        <a href={href.home} className="text-sm text-muted hover:text-accent">← All sites</a>
        <h1 className="font-display mt-6 text-3xl font-semibold">Watchtower isn’t watching {slug}.ms.computer</h1>
        <p className="mt-3 text-muted">
          <a href={href.how('add')} className="text-accent underline underline-offset-2">Here’s how to add it</a> — it takes a minute.
        </p>
      </section>
    )

  const status = statusOf(s, summary.generated)
  const last = s.last
  const badge = `${DATA}/badges/${slug}.svg`
  const badgeMd = `[![Uptime on ms.computer](${badge})](${SITE_URL}#/site/${slug})`

  return (
    <>
      <section className="border-b border-line bg-white">
        <div className="mx-auto max-w-shell px-5 pb-10 pt-10 md:px-8">
          <a href={href.home} className="text-sm text-muted hover:text-accent">← All sites</a>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <h1 className="font-display text-[clamp(2.2rem,5vw,3.6rem)] font-semibold leading-none tracking-[-0.035em]">{s.name}</h1>
            <StatusPill status={status} className="text-[15px]" />
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            <a href={s.url} target="_blank" rel="noopener" className="font-mono text-accent underline underline-offset-2">{new URL(s.url).hostname} ↗</a>
            {s.repo && (
              <a href={`https://github.com/${s.repo}`} target="_blank" rel="noopener" className="font-mono text-muted hover:text-accent">github.com/{s.repo} ↗</a>
            )}
          </p>
          {last && (
            <p className="mt-4 text-[14px] text-ink2">
              Last checked {when(last.at)}: {last.up ? <>answered <strong>{last.status}</strong> in {secs(last.ttfb)}</> : <strong className="text-badText">{reasonOf(last)}</strong>}
              {last.tries === 2 && last.up && <> (on the second try — the first got {last.firstError})</>}. <Receipt run={summary.run} />
            </p>
          )}
          <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Uptime, 24 h" value={pct(s.up24)} note={`${s.checks24} checks`} tone={s.up24 != null && s.up24 < 0.95 ? 'bad' : undefined} />
            <Stat label="Uptime, 7 days" value={pct(s.up7)} />
            <Stat label="Median response" value={secs(s.ttfb50)} note={s.ttfb90 != null ? `slowest 10%: over ${secs(s.ttfb90)}` : 'no good answers in 24 h'} />
            <Stat
              label="Served by miners"
              value={pct(s.replica24)}
              note={last?.up ? <>last answer: <ServedBy upstream={last.upstream} up /></> : s.replica24 != null ? 'of good answers, 24 h' : 'no good answers in 24 h'}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-shell px-5 pt-12 md:px-8">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">7 days, hour by hour</h2>
        <div className="mt-4 border border-line bg-white p-4 md:p-6">
          <HourBars hours={summary.hours} h={s.h} height={40} />
        </div>
      </section>

      <section className="mx-auto max-w-shell px-5 pt-12 md:px-8">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Response time</h2>
        <p className="mt-1 text-muted">Median time to first byte of each hour’s good answers, from GitHub’s servers.</p>
        <div className="mt-4 border border-line bg-white p-4 md:p-6">
          <LineChart hours={summary.hours} values={s.h.map((h) => h?.[2] ?? null)} label={`${s.name}: median time to first byte per hour, last 7 days`} />
        </div>
        {last?.up && last.ttfb != null && (
          <div className="mt-4 border border-line bg-white p-4 md:p-6">
            <p className="text-[14px] font-semibold text-ink">Where the time went in the last check ({secs(last.ttfb)})</p>
            <p className="mb-3 text-[13px] text-muted">The first three depend on the distance between GitHub and Cloudflare{last.colo ? ` (${last.colo})` : ''}; the last is ms.computer and its miners at work.</p>
            <Phases dns={last.dns} connect={last.connect} tls={last.tls} ttfb={last.ttfb} />
          </div>
        )}
      </section>

      <section className="mx-auto max-w-shell px-5 pt-12 md:px-8">
        <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Downtime, last 7 days</h2>
        {s.incidents.length === 0 ? (
          <p className="mt-3 text-muted">None. Every check got a good answer.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line border border-line bg-white">
            {s.incidents.map((i) => (
              <li key={i.start} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5">
                <span className="text-[15px]">{i.reason}</span>
                <span className="tabular text-[13px] text-muted">
                  {when(i.start)} → {i.end ? when(i.end) : <strong className="text-badText">still down</strong>} · {duration(i.start, i.end)} · {i.checks} failed {i.checks === 1 ? 'check' : 'checks'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mx-auto grid max-w-shell gap-4 px-5 pt-12 md:px-8 lg:grid-cols-2">
        <BrowserTest urls={[{ url: s.url, name: s.name }]} title="Test it from your browser" />
        <div className="border border-line bg-white p-5">
          <h3 className="font-display text-lg font-semibold">Uptime badge for your README</h3>
          <p className="mt-1 text-[14px] text-muted">Updated with every check. It links back here.</p>
          <img src={badge} alt={`${s.name} uptime badge`} className="mt-3 h-5" />
          <div className="mt-3">
            <CodeLine text={badgeMd} />
          </div>
          <p className="mt-4 text-[13px] text-muted">
            Raw data for this site is in every file on the{' '}
            <a href={DATA_TREE} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">data branch ↗</a>.
          </p>
        </div>
      </section>

    </>
  )
}
