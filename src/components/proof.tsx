import { useState } from 'react'
import { timeFromBrowser, type BrowserResult } from '../lib/browser'
import { DATA, REPO, secs, type Loaded } from '../lib/data'
import { verifyCommand, verifyText, type Verdict } from '../lib/verify'

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        } catch {
          /* blocked */
        }
      }}
      className="shrink-0 border border-line bg-white px-2.5 py-1 text-[12px] font-semibold hover:border-ink/30"
    >
      {done ? 'Copied ✓' : 'Copy'}
    </button>
  )
}

export function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 border border-line bg-bg2 p-2.5">
      <code className="font-mono min-w-0 flex-1 break-all text-[12px] leading-relaxed text-ink2">{text}</code>
      <Copy text={text} />
    </div>
  )
}

/** Hashes the summary this page loaded and asks GitHub for the probe's signature on it. */
export function VerifyData({ data }: { data: Loaded }) {
  const [v, setV] = useState<Verdict | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    setV(await verifyText(REPO, data.raw))
    setBusy(false)
  }
  return (
    <div className="border border-line bg-white p-5">
      <h3 className="font-display text-lg font-semibold">Is this data untouched?</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">
        Your browser hashes the exact file this page is showing and asks GitHub for the probe’s signature on that hash.
      </p>
      <button type="button" onClick={run} disabled={busy} className="mt-3 border border-ink bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink2 disabled:opacity-60">
        {busy ? 'Checking…' : v ? 'Check again' : 'Verify this data'}
      </button>
      {v && (
        <div className="mt-4 text-[14px]">
          {v.state === 'signed' && (
            <p className="text-goodText">
              <strong>✓ Signed by the probe.</strong>{' '}
              <span className="text-ink2">
                GitHub holds a signature for this exact file, made by <span className="font-mono text-[13px]">{v.workflow ?? 'the probe workflow'}</span>
                {v.runUrl && (
                  <>
                    {' '}in{' '}
                    <a href={v.runUrl} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">this run ↗</a>
                  </>
                )}
                .
              </span>
            </p>
          )}
          {v.state === 'unsigned' && (
            <p className="text-badText">
              <strong>No signature found for this file.</strong> <span className="text-ink2">If you loaded it in the last few seconds, the run may still be signing; otherwise it was not written by the probe.</span>
            </p>
          )}
          {v.state === 'error' && <p className="text-ink2">Couldn’t check: {v.note}</p>}
          <p className="font-mono mt-2 break-all text-[11.5px] text-muted">sha256 {v.sha256}</p>
        </div>
      )}
      <p className="mt-4 text-[13px] text-muted">Don’t trust this page either? Check it yourself with GitHub’s CLI:</p>
      <div className="mt-2">
        <CodeLine text={verifyCommand(DATA, REPO)} />
      </div>
    </div>
  )
}

/** Times the sites from the visitor's own browser. */
export function BrowserTest({ urls, title = 'Test from your browser' }: { urls: { url: string; name: string }[]; title?: string }) {
  const [res, setRes] = useState<Record<string, BrowserResult | 'busy'>>({})
  const [busy, setBusy] = useState(false)
  const start = async () => {
    setBusy(true)
    setRes(Object.fromEntries(urls.map((u) => [u.url, 'busy' as const])))
    for (const u of urls) {
      const r = await timeFromBrowser(u.url)
      setRes((p) => ({ ...p, [u.url]: r }))
    }
    setBusy(false)
  }
  const done = Object.values(res).filter((r): r is BrowserResult => r !== 'busy')
  return (
    <div className="border border-line bg-white p-5">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">
        Times {urls.length === 1 ? 'the site' : `all ${urls.length} sites, one by one,`} from where you are, to compare with the probe. Browsers don’t let a page
        read another site’s answer, so this shows <em>that</em> it answered and how fast — not whether the answer was an error page.
      </p>
      <button type="button" onClick={start} disabled={busy} className="mt-3 border border-accent bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-[#7d4ff0] disabled:opacity-60">
        {busy ? `Testing… ${done.length}/${urls.length}` : done.length ? 'Test again' : 'Start the test'}
      </button>
      {Object.keys(res).length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line text-[14px]">
          {urls.map((u) => {
            const r = res[u.url]
            return (
              <li key={u.url} className="flex items-center justify-between gap-3 py-1.5">
                <span className="truncate">{u.name}</span>
                <span className={`tabular font-mono text-[13px] ${r && r !== 'busy' && !r.ok ? 'text-badText' : 'text-ink2'}`}>
                  {r === 'busy' || !r ? '…' : r.ok ? secs(r.ms) : r.error}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
