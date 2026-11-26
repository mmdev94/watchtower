// Alert feeds (Atom): one per site and one for the whole network. Any feed
// reader can follow them, and so can Discord or Slack feed bots. Each event is
// its own entry with a stable id, so readers show it once.
import { slug, type Summary } from './model.ts'

export interface FeedEntry {
  id: string
  at: string
  title: string
  text: string
  link: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function minutesBetween(a: string, b: string | null, now: string): string {
  const m = Math.max(1, Math.round((Date.parse(b ?? now) - Date.parse(a)) / 60_000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`
}

/** `page` turns a site slug (or null for the network) into a link on the Watchtower site. */
export function siteEntries(summary: Summary, siteSlug: string, page: (slug: string | null) => string): FeedEntry[] {
  const s = summary.sites.find((x) => slug(x.url) === siteSlug)
  if (!s) return []
  const link = page(siteSlug)
  const out: FeedEntry[] = []
  for (const i of s.incidents) {
    const also = i.network ? ' Many other sites were down at the same time, so this was likely ms.computer itself.' : ''
    out.push({ id: `${siteSlug}:down:${i.start}`, at: i.start, title: `${s.name} is down: ${i.reason}`, text: `Watchtower’s check got ${i.reason}, twice, 5 seconds apart.${also}`, link })
    if (i.end)
      out.push({ id: `${siteSlug}:up:${i.start}`, at: i.end, title: `${s.name} is back up after ${minutesBetween(i.start, i.end, summary.generated)}`, text: `Down since ${i.start} (${i.checks} failed checks).`, link })
  }
  for (const t of s.takeovers)
    if (t.end)
      out.push({ id: `${siteSlug}:miners:${t.start}`, at: t.end, title: `${s.name}: miners took over ${t.minutes} min after the deploy`, text: `ms.computer’s own copy answered from ${t.start}; a miner’s copy answered at ${t.end}.`, link })
  return out
}

export function networkEntries(summary: Summary, page: (slug: string | null) => string): FeedEntry[] {
  const out: FeedEntry[] = []
  for (const o of summary.network.outages) {
    out.push({ id: `network:down:${o.start}`, at: o.start, title: `ms.computer outage: ${o.peak} of ${o.of} sites down`, text: `Many sites failed in the same check, so the problem is likely ms.computer itself, not the sites.`, link: page(null) })
    if (o.end) out.push({ id: `network:up:${o.start}`, at: o.end, title: `ms.computer outage over after ${minutesBetween(o.start, o.end, summary.generated)}`, text: `Most sites answer again.`, link: page(null) })
  }
  for (const s of summary.sites) out.push(...siteEntries(summary, slug(s.url), page).filter((e) => !e.id.includes(':miners:')))
  return out
}

export function atom(opts: { id: string; title: string; self: string; link: string; updated: string; entries: FeedEntry[] }): string {
  const entries = [...opts.entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100)
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(opts.id)}</id>
  <title>${esc(opts.title)}</title>
  <link rel="self" href="${esc(opts.self)}"/>
  <link rel="alternate" href="${esc(opts.link)}"/>
  <updated>${esc(entries[0]?.at ?? opts.updated)}</updated>
  <author><name>Watchtower</name></author>
${entries
  .map(
    (e) => `  <entry>
    <id>tag:watchtower,2026:${esc(e.id)}</id>
    <title>${esc(e.title)}</title>
    <updated>${esc(e.at)}</updated>
    <link href="${esc(e.link)}"/>
    <summary>${esc(e.text)}</summary>
  </entry>`,
  )
  .join('\n')}
</feed>
`
}
