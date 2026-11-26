import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Check, Site, Summary } from '../src/lib/model.ts'
import { check, checkAll, logLine, mergeSites, readRuns, topicSites, write } from './probe.ts'

const fake = (url: string, up: boolean, extra: Partial<Check> = {}): Check => ({
  url, up, status: up ? 200 : 503, ttfb: up ? 100 : null, total: up ? 120 : null, dns: 1, connect: 2, tls: 3, wait: 97, upstream: up ? 'replica' : null, colo: 'IAD', bytes: 10, error: null, tries: 1, ...extra,
})
const noWait = async () => {}

test('a failed first try is retried once; only two failures count as down', async () => {
  let calls = 0
  const flaky = async (u: string) => fake(u, ++calls > 1)
  const c = await check('https://a.ms.computer', flaky, noWait)
  assert.equal(c.up, true)
  assert.equal(c.tries, 2)
  assert.equal(c.firstError, 'HTTP 503')

  const down = await check('https://a.ms.computer', async (u) => fake(u, false), noWait)
  assert.equal(down.up, false)
  assert.equal(down.tries, 2)
  assert.equal(down.firstError, undefined)

  let n = 0
  await check('https://a.ms.computer', async (u) => (n++, fake(u, true)), noWait)
  assert.equal(n, 1)
})

test('checkAll keeps the order of the list', async () => {
  const sites = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => ({ url: `https://${x}.ms.computer`, name: x, repo: null, source: 'list' as const }))
  const out = await checkAll(sites, async (u) => {
    await new Promise((r) => setTimeout(r, Math.random() * 10))
    return fake(u, true)
  })
  assert.deepEqual(out.map((c) => c.url), sites.map((s) => s.url))
})

test('mergeSites: list first, tagged repos after, no duplicates, excludes honoured', () => {
  const topic: Site[] = [
    { url: 'https://a-x1111.ms.computer', name: 'A', repo: 'o/a', source: 'topic' },
    { url: 'https://new-y2222.ms.computer', name: 'New', repo: 'o/new', source: 'topic' },
    { url: 'https://gone-z3333.ms.computer', name: 'Gone', repo: 'o/gone', source: 'topic' },
  ]
  const out = mergeSites(
    { sites: [{ url: 'https://a-x1111.ms.computer/', name: 'Alpha' }, { url: 'not a url' }], exclude: ['https://gone-z3333.ms.computer'] },
    topic,
  )
  assert.deepEqual(out, [
    { url: 'https://a-x1111.ms.computer', name: 'Alpha', repo: 'o/a', source: 'list' },
    { url: 'https://new-y2222.ms.computer', name: 'New', repo: 'o/new', source: 'topic' },
  ])
})

test('topicSites reads the Website field, else the latest ms-computer deployment', async () => {
  const get = async <T,>(path: string): Promise<T> => {
    if (path.startsWith('/search/')) {
      return {
        items: [
          { name: 'a', full_name: 'o/a', homepage: 'https://a-x1111.ms.computer', owner: { login: 'o' } },
          { name: 'b', full_name: 'o/b', homepage: 'https://example.com', owner: { login: 'o' } },
          { name: 'c', full_name: 'o/c', homepage: null, owner: { login: 'o' } },
        ],
      } as T
    }
    if (path === '/repos/o/b/deployments?environment=ms-computer&per_page=1') return [{ id: 7 }] as T
    if (path === '/repos/o/b/deployments/7/statuses?per_page=1') return [{ state: 'success', environment_url: 'https://b-y2222.ms.computer' }] as T
    if (path.startsWith('/repos/o/c/')) throw new Error('403')
    return [] as T
  }
  const out = await topicSites(get)
  assert.deepEqual(out.map((s) => [s.url, s.repo]), [
    ['https://a-x1111.ms.computer', 'o/a'],
    ['https://b-y2222.ms.computer', 'o/b'],
  ])
})

test('write: appends the day file, rewrites latest + summary + badges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-'))
  try {
    const sites: Site[] = [{ url: 'https://a-x1111.ms.computer', name: 'A', repo: null, source: 'list' }]
    const r1 = { v: 1 as const, at: '2026-11-26T10:00:00.000Z', run: null, sha: null, checks: [fake(sites[0].url, true)] }
    const r2 = { ...r1, at: '2026-11-26T10:05:00.000Z', checks: [fake(sites[0].url, false)] }
    await write(dir, r1, sites, new Date(r1.at))
    await write(dir, r2, sites, new Date(r2.at))
    const day = (await readFile(join(dir, 'days', '2026-11-26.jsonl'), 'utf8')).trim().split('\n')
    assert.equal(day.length, 2)
    assert.equal((await readRuns(dir)).length, 2)
    const summary = JSON.parse(await readFile(join(dir, 'summary.json'), 'utf8')) as Summary
    assert.equal(summary.sites[0].up24, 0.5)
    assert.equal(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8')).at, r2.at)
    assert.deepEqual(await readdir(join(dir, 'badges')), ['a-x1111.svg'])
    assert.match(await readFile(join(dir, 'badges', 'a-x1111.svg'), 'utf8'), /down/)
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('the log line is readable', () => {
  assert.match(logLine(fake('https://a.ms.computer', true)), /^UP {3}a\.ms\.computer +200 +100 ms +replica +IAD/)
  assert.match(logLine(fake('https://a.ms.computer', true, { tries: 2, firstError: 'HTTP 502' })), /ok on 2nd try \(1st: HTTP 502\)/)
})
