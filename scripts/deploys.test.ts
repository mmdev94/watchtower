import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pairDeploys, pctl, summarizeDeploys } from './deploys.ts'

const run = (id: number, sha: string, created: string, started: string, conclusion = 'success') => ({ id, head_sha: sha, created_at: created, run_started_at: started, conclusion, html_url: `https://x/runs/${id}` })

test('a push is paired with the deployment recorded for its commit, after the run began', () => {
  const d = pairDeploys(
    [run(1, 'aaaaaaa1', '2026-11-27T10:00:00Z', '2026-11-27T10:00:07Z'), run(2, 'bbbbbbb2', '2026-11-27T11:00:00Z', '2026-11-27T11:00:03Z', 'failure'), run(3, 'ccccccc3', '2026-11-27T12:00:00Z', '2026-11-27T12:00:05Z')],
    [
      { sha: 'aaaaaaa1', created_at: '2026-11-27T09:00:00Z' }, // an older record of the same commit (a rollback) is ignored
      { sha: 'aaaaaaa1', created_at: '2026-11-27T10:02:30Z' },
      { sha: 'bbbbbbb2', created_at: '2026-11-27T11:03:00Z' },
      { sha: 'ccccccc3', created_at: '2026-11-27T14:00:00Z' }, // 2 hours later: not this run's deploy
    ],
  )
  assert.deepEqual(d, [{ sha: 'aaaaaaa', pushed: '2026-11-27T10:00:00Z', live: '2026-11-27T10:02:30Z', total: 150, queued: 7, run: 'https://x/runs/1' }])
})

test('the summary: median, 90th percentile, extremes, waiting for runners', () => {
  const mk = (total: number, queued = 5) => ({ sha: 'x', pushed: '', live: '', total, queued, run: '' })
  const s = summarizeDeploys([{ repo: 'a/b', mode: 'static', deploys: [mk(100), mk(120), mk(140), mk(300, 60)] }, { repo: 'c/d', mode: null, deploys: [] }], new Date('2026-11-28T00:00:00Z'))
  assert.deepEqual(s.all, { count: 4, repos: 1, median: 120, p90: 300, fastest: 100, slowest: 300, medianQueued: 5 })
  assert.equal(pctl([], 50), null)
})
