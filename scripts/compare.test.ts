import { test } from 'node:test'
import assert from 'node:assert/strict'
import { measurePairs, summarizePair, type CompareRun } from './compare.ts'
import type { Check } from '../src/lib/model.ts'

const pair = { id: 'p', name: 'Page', ms: 'https://a.ms.computer/', other: { host: 'GitHub Pages', url: 'https://x.github.io/p/' } }
const check = (url: string, ttfb: number, up = true): Check => ({ url, up, status: up ? 200 : 503, ttfb, total: ttfb + 5, dns: 1, connect: 2, tls: 3, wait: ttfb - 3, upstream: null, colo: null, bytes: 10, error: null, tries: 1 })

test('three rounds per pair, alternating which host goes first', async () => {
  const order: string[] = []
  const [p] = await measurePairs([pair], async (u) => (order.push(u.includes('ms.computer') ? 'ms' : 'other'), check(u, 100)))
  assert.deepEqual(order, ['ms', 'other', 'other', 'ms', 'ms', 'other'])
  assert.equal(p.samples.length, 6)
})

test('summary: medians per host, failures counted not timed, who was faster per run, hourly line', () => {
  const now = new Date('2026-11-28T00:00:00Z')
  const s = (host: 'ms' | 'other', ttfb: number, up = true) => ({ host, ttfb: up ? ttfb : null, wait: ttfb - 3, total: ttfb + 5, status: up ? 200 : 503, up, upstream: null })
  const runs: CompareRun[] = [
    { at: '2026-11-27T23:00:00Z', run: null, pairs: [{ id: 'p', samples: [s('ms', 100), s('other', 200), s('other', 210), s('ms', 110), s('ms', 120), s('other', 190)] }] },
    { at: '2026-11-27T23:30:00Z', run: null, pairs: [{ id: 'p', samples: [s('ms', 300), s('other', 150), s('other', 0, false), s('ms', 310), s('ms', 320), s('other', 160)] }] },
    { at: '2026-11-20T00:00:00Z', run: null, pairs: [{ id: 'p', samples: [s('ms', 1), s('other', 1)] }] }, // outside 24 h
  ]
  const r = summarizePair(pair, runs, now, 24 * 3_600_000)
  assert.equal(r.runs, 2)
  assert.equal(r.ms.samples, 6)
  assert.equal(r.other.failed, 1)
  assert.equal(r.ms.ttfb50, 120)
  assert.equal(r.other.ttfb50, 190)
  assert.equal(r.msFaster, 0.5, 'faster in the first run, slower in the second')
  assert.equal(r.hours.length, 24)
  assert.deepEqual(r.hours[23], { ms: 120, other: 190 })
})
