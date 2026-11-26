import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarize, type Check, type Run, type Site } from '../src/lib/model.ts'
import { apply, currentStates, plan } from './alerts.ts'

const A = 'https://a-x1111.ms.computer'
const sites: Site[] = [{ url: A, name: 'Alpha', repo: null, source: 'list' }]
const c = (up: boolean): Check => ({ url: A, up, status: up ? 200 : 503, ttfb: up ? 300 : null, total: null, dns: null, connect: null, tls: null, wait: null, upstream: up ? 'replica' : null, colo: null, bytes: null, error: null, tries: up ? 1 : 2 })
const at = (m: number) => new Date(Date.UTC(2026, 10, 26, 12, m)).toISOString()
const runs = (...ups: boolean[]): Run[] => ups.map((u, i) => ({ v: 1, at: at(i * 5), run: { id: '9', attempt: 1, url: 'https://gh/run/9' }, sha: null, checks: [c(u)] }))
const sum = (...ups: boolean[]) => summarize(runs(...ups), sites, new Date(at(ups.length * 5)), { id: '9', attempt: 1, url: 'https://gh/run/9' })
const page = (s: string | null) => `https://w.test/#/${s ? `site/${s}` : ''}`

test('states', () => {
  assert.equal(currentStates(sum(true, false))['a-x1111'], 'pending')
  assert.equal(currentStates(sum(true, false, false))['a-x1111'], 'down')
  assert.equal(currentStates(sum(false, false, true))['a-x1111'], 'up')
  assert.equal(currentStates(sum(true))['network'], 'up')
})

test('plan: first sight is quiet, then each change is one comment', () => {
  assert.deepEqual(plan(sum(true, false, false), { issues: {}, state: {} }, page), [])
  const down = plan(sum(true, false, false), { issues: {}, state: { 'a-x1111': 'up' } }, page)
  assert.equal(down.length, 1)
  assert.match(down[0].body, /Alpha is down.*HTTP 503.*2 checks/s)
  assert.match(down[0].body, /https:\/\/w\.test\/#\/site\/a-x1111/)
  assert.match(down[0].body, /https:\/\/gh\/run\/9/)
  assert.deepEqual(plan(sum(true, false), { issues: {}, state: { 'a-x1111': 'up' } }, page), [])
  const up = plan(sum(true, false, false, true), { issues: {}, state: { 'a-x1111': 'down' } }, page)
  assert.match(up[0].body, /back up\*\* after 10 min/)
})

test('apply: finds or makes issues, posts, records; a failed post is retried next time', async () => {
  const calls: string[] = []
  let failComments = true
  const api = async (method: string, path: string, body?: unknown) => {
    calls.push(`${method} ${path}`)
    if (path.startsWith('/issues?')) return [{ number: 4, body: 'x\n<!-- watchtower-alerts:network -->' }]
    if (path === '/issues') return { number: 7, ...(body as object) }
    if (path.endsWith('/comments')) {
      if (failComments) throw new Error('502')
      return {}
    }
    return {}
  }
  const s = sum(true, false, false)
  const first = await apply(api, s, { issues: {}, state: { 'a-x1111': 'up' } }, page, () => {})
  assert.deepEqual(first.issues, { network: 4, 'a-x1111': 7 })
  assert.equal(first.state['a-x1111'], 'up', 'the down alert failed, so it is still owed')
  assert.ok(calls.includes('POST /labels'))
  failComments = false
  calls.length = 0
  const second = await apply(api, s, first, page, () => {})
  assert.equal(second.state['a-x1111'], 'down')
  assert.deepEqual(calls.filter((x) => x.startsWith('POST')), ['POST /issues/7/comments'])
})
