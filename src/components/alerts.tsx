import { feedUrl, issueUrl, useAlerts } from '../lib/data'
import { CodeLine } from './proof'

/** "Get alerts": an email via a GitHub issue subscription, or a feed. `slug` null = the whole network. */
export function GetAlerts({ slug, name }: { slug: string | null; name: string }) {
  const alerts = useAlerts()
  const n = alerts?.issues[slug ?? 'network']
  return (
    <div className="border border-line bg-white p-5">
      <h3 className="font-display text-lg font-semibold">Get alerts{slug ? ` for ${name}` : ''}</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">
        {slug
          ? `A message when ${name} goes down (two failed checks in a row) and when it’s back.`
          : 'A message when many sites go down at once — a problem with ms.computer itself — and when it’s over.'}{' '}
        No sign-up here.
      </p>
      <div className="mt-4 grid gap-4">
        <div>
          <p className="text-[14px] font-semibold text-ink">By email</p>
          {n ? (
            <p className="mt-1 text-[14px] text-ink2">
              Open{' '}
              <a href={issueUrl(n)} target="_blank" rel="noopener" className="font-semibold text-accent underline underline-offset-2">
                its alert issue on GitHub ↗
              </a>{' '}
              and press <strong>Subscribe</strong>. GitHub emails you each alert (a free GitHub account is needed).
            </p>
          ) : (
            <p className="mt-1 text-[14px] text-muted">The alert issue is being set up; it appears within a few checks.</p>
          )}
        </div>
        <div>
          <p className="text-[14px] font-semibold text-ink">In a feed reader, Discord or Slack</p>
          <p className="mb-2 mt-1 text-[14px] text-ink2">Add this feed to a reader, or to a Discord/Slack feed bot:</p>
          <CodeLine text={feedUrl(slug)} />
        </div>
      </div>
    </div>
  )
}
