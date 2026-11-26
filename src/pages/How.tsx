import type { ReactNode } from 'react'
import { CodeLine } from '../components/proof'
import { DATA, DATA_TREE, PROBE_RUNS, REPO } from '../lib/data'
import { href } from '../lib/route'

const GH = `https://github.com/${REPO}`

function Block({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10">
      <h2 className="font-display text-[1.7rem] font-semibold tracking-[-0.02em]">{title}</h2>
      <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-ink2">{children}</div>
    </section>
  )
}

const A = ({ to, children }: { to: string; children: ReactNode }) => (
  <a href={to} target={to.startsWith('#') ? undefined : '_blank'} rel="noopener" className="text-accent underline underline-offset-2">{children}</a>
)

export function How() {
  return (
    <div className="mx-auto max-w-[760px] px-5 pb-10 pt-10 md:px-8">
      <a href={href.home} className="text-sm text-muted hover:text-accent">← All sites</a>
      <span className="eyebrow mt-8 flex">How it’s measured</span>
      <h1 className="font-display mt-4 text-[clamp(2.2rem,5vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.035em]">Every number has a receipt.</h1>
      <p className="mt-5 text-lg leading-relaxed text-muted">
        A status page is only worth something if you can check it. Here is exactly what Watchtower does, where to see it happen, and what it can’t tell you.
      </p>

      <div className="mt-12 space-y-12">
        <Block title="What a check is">
          <p>
            Every 5 minutes a GitHub Action (<A to={`${GH}/blob/main/.github/workflows/probe.yml`}>probe.yml</A>) runs{' '}
            <A to={`${GH}/blob/main/scripts/probe.ts`}>scripts/probe.ts</A>. For each site it sends <strong>one ordinary request for the home page</strong>, the
            same one your browser sends, and records:
          </p>
          <ul className="list-disc space-y-1.5 pl-6">
            <li><strong>Up or down.</strong> Up is any 2xx or 3xx answer. If the first try fails it waits 5 seconds and tries once more; only two failures count as down.</li>
            <li><strong>Time to first byte</strong>, split into finding the address, connecting, the secure handshake, and the server’s answer.</li>
            <li>
              <strong>Who answered.</strong> ms.computer adds a header, <code className="font-mono text-[14px]">x-ms-edge-upstream</code>, to every page:{' '}
              <code className="font-mono text-[14px]">replica</code> when a miner’s copy of the site answered, <code className="font-mono text-[14px]">origin</code> when
              ms.computer’s own copy did (usual right after a deploy).
            </li>
            <li><strong>Where from.</strong> The Cloudflare location in the <code className="font-mono text-[14px]">cf-ray</code> header — it shows which data centre the check went through.</li>
          </ul>
          <p>The run’s log prints every check as a line of text, so the raw measurement is readable without any tools.</p>
        </Block>

        <Block title="Outages, deploys and alerts">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Network-wide outage</strong>: half or more of the sites (and at least 3) fail in the same check. Then it’s ms.computer, not the sites, and the
              page says so.
            </li>
            <li>
              <strong>Miners take over in</strong>: after a deploy, answers come from ms.computer’s origin until miners serve the site. Watchtower times each switch from
              the first origin answer to the first miner answer. Checks are 5 minutes apart, so each time is ±5 minutes, and switches faster than one check aren’t seen.
            </li>
            <li>
              <strong>Alerts</strong>: every site has an alert issue on GitHub. When a site has failed two checks in a row (about 10 minutes), the probe comments on it, and
              again when it’s back — GitHub emails everyone subscribed. The same events are in an Atom feed per site, and one for the network.
            </li>
            <li>
              <strong>Control check</strong>: each run also fetches a page that isn’t on ms.computer (github.com). If that fails too, the probe’s own connection was the
              problem; the run is kept in the raw data but left out of every number.
            </li>
          </ul>
        </Block>

        <Block title="Why you can trust the numbers">
          <ol className="list-decimal space-y-3 pl-6">
            <li><strong>The checks run in public.</strong> <A to={PROBE_RUNS}>Every run</A> is on GitHub, with its log. Each page links to the run behind its numbers.</li>
            <li>
              <strong>The results are kept, not overwritten.</strong> Each run commits its results to the <A to={DATA_TREE}>data branch</A>: one file per day, one line per
              run. The history is public.
            </li>
            <li>
              <strong>The results are signed.</strong> Each run signs the files it wrote with GitHub’s build attestations (Sigstore). The signature names the workflow, the
              commit and the run, and is logged in a public, append-only transparency log. Editing a file afterwards breaks its signature — and the page can check that
              for you (<em>Verify this data</em>), or you can:
            </li>
          </ol>
          <CodeLine text={`curl -sO ${DATA}/summary.json && gh attestation verify summary.json -R ${REPO}`} />
          <ol start={4} className="list-decimal space-y-3 pl-6">
            <li><strong>You can measure it yourself.</strong> <em>Test from your browser</em> times the sites from where you are.</li>
            <li><strong>You can run your own.</strong> See below — same code, your GitHub account, your numbers.</li>
          </ol>
        </Block>

        <Block title="What it can’t tell you">
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>It sees from one place.</strong> GitHub’s runners are in US data centres, so times are for a visitor near them. A visitor elsewhere will see different
              numbers — that’s what the browser test is for.
            </li>
            <li>
              <strong>Gaps are gaps.</strong> GitHub runs scheduled workflows “at best effort” and sometimes late or not at all. A missed check is shown as no data, never as
              down.
            </li>
            <li>
              <strong>It can’t count miners.</strong> The answer says <em>a</em> miner’s copy served it, not which or how many. Watchtower doesn’t guess.
            </li>
            <li><strong>Home page only.</strong> It checks that the site answers, not that every feature on it works.</li>
          </ul>
        </Block>

        <Block id="add" title="Add your site">
          <p>
            <strong>Have a GitHub repo for it?</strong> Add the topic <code className="font-mono text-[14px]">ms-computer</code> (⚙ next to <em>About</em> on the repo page) and set{' '}
            <em>Website</em> to your <code className="font-mono text-[14px]">…ms.computer</code> address. Watchtower looks for tagged repos once an hour. If the Website field is empty, it also looks at the repo’s latest GitHub deployment to an
            environment named <code className="font-mono text-[14px]">ms-computer</code>.
          </p>
          <p>
            <strong>No repo?</strong> <A to={`${GH}/issues/new?template=add-site.yml`}>Open an issue with the address</A> and it gets added to{' '}
            <A to={`${GH}/blob/main/config/sites.json`}>the list</A>.
          </p>
          <p>
            <strong>Want yours removed?</strong> <A to={`${GH}/issues/new?template=remove-site.yml`}>Open an issue</A>, or a pull request adding it to{' '}
            <code className="font-mono text-[14px]">exclude</code>. The probe sends about 12 requests an hour, identified as{' '}
            <code className="font-mono text-[14px]">Watchtower/1.0</code>.
          </p>
        </Block>

        <Block id="run" title="Run your own Watchtower">
          <p>
            Fork <A to={GH}>the repo</A>. The probe starts on its own schedule in your account (Actions are free for public repos) and writes to your fork’s data branch.
            Or run one check on your own computer:
          </p>
          <CodeLine text={`git clone ${GH} && cd watchtower && node --experimental-strip-types scripts/probe.ts --out my-data`} />
          <p>If your numbers disagree with ours, that’s worth an issue.</p>
        </Block>
      </div>
    </div>
  )
}
