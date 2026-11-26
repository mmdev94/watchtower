import assert from 'node:assert/strict'
import { test } from 'node:test'
import { badgeSvg, badgeText } from './badge.ts'
import { incidents, msUrl, nameFromHost, percentile, slug, summarize, type Check, type Run, type Site } from './model.ts'

const ok = (url: string, ttfb = 400, upstream: string | null = 'replica'): Check => ({
  url, up: true, status: 200, ttfb, total: ttfb + 20, dns: 5, connect: 20, tls: 60, wait: ttfb - 60, upstream, colo: 'DFW', bytes: 1000, error: null, tries: 1,
})
const bad = (url: string, status: number | null = 503, error: string | null = null): Check => ({
  url, up: false, status, ttfb: null, total: null, dns: null, connect: null, tls: null, wait: null, upstream: null, colo: null, bytes: null, error, tries: 2,
})
const run = (at: string, checks: Check[]): Run => ({ v: 1, at, run: null, sha: null, checks })
const A = 'https://a-x1111.ms.computer'
const B = 'https://b-y2222.ms.computer'
const sites: Site[] = [
  { url: A, name: 'A', repo: null, source: 'list' },
  { url: B, name: 'B', repo: 'o/b', source: 'topic' },
]

test('percentile is nearest-rank', () => {
  assert.equal(percentile([], 50), null)
  assert.equal(percentile([5], 90), 5)
  assert.equal(percentile([1, 2, 3, 4], 50), 2)
  assert.equal(percentile([10, 1, 3, 2, 4, 5, 6, 7, 8, 9], 90), 9)
})

test('an incident runs from the first failed check to the next good one', () => {
  const list = [
    { at: '2026-11-26T10:00:00Z', c: ok(A) },
    { at: '2026-11-26T10:05:00Z', c: bad(A) },
    { at: '2026-11-26T10:10:00Z', c: bad(A, null, 'No answer within 15 s') },
    { at: '2026-11-26T10:15:00Z', c: ok(A) },
    { at: '2026-11-26T10:20:00Z', c: bad(A, 421) },
  ]
  assert.deepEqual(incidents(list), [
    { start: '2026-11-26T10:05:00Z', end: '2026-11-26T10:15:00Z', checks: 2, reason: 'HTTP 503 (service unavailable)' },
    { start: '2026-11-26T10:20:00Z', end: null, checks: 1, reason: 'HTTP 421 (address not known to ms.computer)' },
  ])
})

test('summarize: uptime, medians, replica share, hour buckets, gaps', () => {
  const now = new Date('2026-11-26T12:30:00Z')
  const runs = [
    run('2026-11-26T12:00:00Z', [ok(A, 300), bad(B)]),
    run('2026-11-26T12:05:00Z', [ok(A, 500, 'origin'), ok(B, 900)]),
    run('2026-11-26T11:00:00Z', [ok(A, 400), ok(B, 800)]),
    run('2026-11-10T11:00:00Z', [bad(A)]), // older than 7 days: ignored
  ]
  const s = summarize(runs, sites, now)
  assert.equal(s.hours.length, 168)
  assert.equal(s.hours.at(-1), '2026-11-26T12:00:00.000Z')
  assert.deepEqual(s.runsPerHour.slice(-2), [1, 2])
  assert.equal(s.runsPerHour.slice(0, -2).reduce((a, b) => a + b, 0), 0)
  const [a, b] = s.sites
  assert.equal(a.up24, 1)
  assert.equal(a.checks24, 3)
  assert.equal(a.ttfb50, 400)
  assert.equal(a.replica24, 2 / 3)
  assert.deepEqual(a.h.at(-1), [2, 2, 300, 1])
  assert.equal(a.h[0], null)
  assert.equal(a.last?.at, '2026-11-26T12:05:00Z')
  assert.equal(b.up24, 2 / 3)
  assert.deepEqual(b.h.at(-1), [2, 1, 900, 1])
  assert.equal(b.incidents.length, 1)
  assert.equal(b.incidents[0].end, '2026-11-26T12:05:00Z')
  assert.equal(s.from.DFW, 5)
})

test('a site with no checks yet has no numbers, not zeros', () => {
  const s = summarize([], sites, new Date('2026-11-26T12:00:00Z'))
  assert.equal(s.sites[0].up24, null)
  assert.equal(s.sites[0].ttfb50, null)
  assert.equal(s.sites[0].last, null)
})

test('names and addresses', () => {
  assert.equal(slug('https://chrono-n2732.ms.computer'), 'chrono-n2732')
  assert.equal(nameFromHost('letter-to-the-future-y2765.ms.computer'), 'Letter To The Future')
  assert.equal(msUrl('https://Foo-a1234.ms.computer/'), 'https://foo-a1234.ms.computer')
  assert.equal(msUrl('https://evil.com/?x=.ms.computer'), null)
  assert.equal(msUrl('https://a.ms.computer.evil.com'), null)
})

test('badge text and colours', () => {
  assert.equal(badgeText(null, null), 'no data yet')
  assert.equal(badgeText(1, true), '100% up 24h')
  assert.equal(badgeText(0.9987, true), '99.8% up 24h')
  assert.equal(badgeText(0.9, false), 'down · 90.0% 24h')
  assert.match(badgeSvg(1, true), /#1fae63/)
  assert.match(badgeSvg(0.97, true), /#c98a1e/)
  assert.match(badgeSvg(1, false), /#d0453a/)
  assert.doesNotMatch(badgeSvg(1, true, '<x>'), /<x>/)
})

test('outages: half the sites (and at least 3) down in one run', async () => {
  const { outages } = await import('./model.ts')
  const s = (n: number) => `https://s${n}-a1111.ms.computer`
  const r = (at: string, down: number, total = 6) => run(at, Array.from({ length: total }, (_, i) => (i < down ? bad(s(i)) : ok(s(i)))))
  assert.deepEqual(outages([r('t1', 2), r('t2', 3), r('t3', 5), r('t4', 1), r('t5', 2, 3)]), [{ start: 't2', end: 't4', runs: 2, peak: 5, of: 6 }])
})

test('takeovers: origin answers until the first miner answer; failures in between don’t end it', async () => {
  const { takeovers } = await import('./model.ts')
  const at = (m: number) => new Date(Date.UTC(2026, 10, 26, 12, m)).toISOString()
  const list = [
    { at: at(0), c: ok(A) },
    { at: at(5), c: bad(A) },
    { at: at(10), c: ok(A, 400, 'origin') },
    { at: at(15), c: bad(A) },
    { at: at(20), c: ok(A, 400, 'origin') },
    { at: at(25), c: ok(A) },
    { at: at(30), c: ok(A, 400, 'origin') },
  ]
  assert.deepEqual(takeovers(list), [
    { start: at(10), end: at(25), minutes: 15 },
    { start: at(30), end: null, minutes: null },
  ])
})

test('summarize: runs where the probe itself was offline are left out; outages flag site incidents', () => {
  const now = new Date('2026-11-26T12:30:00Z')
  const C = 'https://c-z3333.ms.computer'
  const three: Site[] = [...sites, { url: C, name: 'C', repo: null, source: 'list' }]
  const offline = { ...run('2026-11-26T12:10:00Z', [bad(A), bad(B), bad(C)]), control: { ok: false, ms: null, error: 'x' } }
  const s = summarize(
    [run('2026-11-26T12:00:00Z', [ok(A), ok(B), ok(C)]), run('2026-11-26T12:05:00Z', [bad(A), bad(B), bad(C)]), offline, run('2026-11-26T12:15:00Z', [ok(A, 300, 'origin'), ok(B), ok(C)]), run('2026-11-26T12:20:00Z', [ok(A), ok(B), ok(C)])],
    three,
    now,
  )
  assert.equal(s.skipped, 1)
  assert.equal(s.sites[0].checks24, 4)
  assert.equal(s.network.outages.length, 1)
  assert.equal(s.network.outages[0].end, '2026-11-26T12:15:00Z')
  assert.equal(s.network.outage, null)
  assert.equal(s.sites[0].incidents[0].network, true)
  assert.deepEqual(s.sites[0].takeovers, [{ start: '2026-11-26T12:15:00Z', end: '2026-11-26T12:20:00Z', minutes: 5 }])
  assert.equal(s.network.takeoverMedian, 5)
})

test('feeds: one entry per event, stable ids, escaped', async () => {
  const { atom, networkEntries, siteEntries } = await import('./feed.ts')
  const now = new Date('2026-11-26T12:30:00Z')
  const s = summarize([run('2026-11-26T12:00:00Z', [ok(A, 300, 'origin'), bad(B)]), run('2026-11-26T12:05:00Z', [ok(A), ok(B)])], sites, now)
  const page = (x: string | null) => `https://w.test/#/${x ?? ''}`
  const b = siteEntries(s, 'b-y2222', page)
  assert.deepEqual(b.map((e) => e.id), ['b-y2222:down:2026-11-26T12:00:00Z', 'b-y2222:up:2026-11-26T12:00:00Z'])
  assert.match(b[1].title, /back up after 5 min/)
  assert.match(siteEntries(s, 'a-x1111', page)[0].title, /miners took over 5 min/)
  assert.equal(networkEntries(s, page).length, 2)
  const xml = atom({ id: 'x', title: 'A & <B>', self: 's', link: 'l', updated: s.generated, entries: b })
  assert.match(xml, /A &amp; &lt;B&gt;/)
  assert.equal((xml.match(/<entry>/g) ?? []).length, 2)
})
