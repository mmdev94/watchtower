// "Test from my browser": the visitor's own measurement, to compare with the
// probe's. Browsers hide other sites' answers (status, headers) from a page,
// so this can only say "it answered, in this long" — not whether the answer
// was a good one. It says so on screen.

export interface BrowserResult {
  url: string
  ok: boolean
  /** total time for the request as the browser saw it */
  ms: number | null
  error?: string
}

export async function timeFromBrowser(url: string, timeout = 15_000): Promise<BrowserResult> {
  const target = `${url}/?watchtower=${Date.now()}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeout)
  const t0 = performance.now()
  try {
    await fetch(target, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal, referrerPolicy: 'no-referrer' })
    const entry = performance.getEntriesByName(target).at(-1) as PerformanceResourceTiming | undefined
    const ms = Math.round(entry && entry.duration > 0 ? entry.duration : performance.now() - t0)
    return { url, ok: true, ms }
  } catch (e) {
    return { url, ok: false, ms: null, error: (e as Error).name === 'AbortError' ? 'No answer within 15 s' : 'Couldn’t reach it from here' }
  } finally {
    clearTimeout(timer)
  }
}
