# Watchtower

**Is ms.computer up?** Watchtower checks ms.computer sites every 5 minutes from GitHub's servers, and shows uptime, response time and whether miners are serving each site. Every number has a receipt: the public run that measured it, and a signature on the data.

Live at **(address after the first deploy)**

## How it works

```
GitHub Actions, every 5 min            data branch (public)               the site (static, on ms.computer)
probe.yml → scripts/probe.ts   ──►   days/2026-11-26.jsonl  (1 line/run)  ──►  reads summary.json from
  one GET per site, timed              latest.json, summary.json               raw.githubusercontent.com
  signed with build attestations       badges/<site>.svg                       and checks its signature
```

- **A check** is one ordinary request for the home page. Up = any 2xx/3xx. A failure is retried once after 5 s; only two failures count as down.
- **Recorded:** status, time to first byte (split into DNS, connect, TLS, server), ms.computer's `x-ms-edge-upstream` header (`replica` = a miner's copy answered, `origin` = ms.computer's own copy, usual right after a deploy), and the Cloudflare location from `cf-ray`.
- **Sites:** [config/sites.json](config/sites.json), plus every GitHub repo tagged `ms-computer` with an ms.computer address in its Website field or in its latest GitHub deployment to an `ms-computer` environment (looked up hourly).

## Checking the checker

- Every run is public: [Actions → Probe](../../actions/workflows/probe.yml). Its log prints every check.
- Every run signs `latest.json` and `summary.json`:
  ```bash
  curl -sO https://raw.githubusercontent.com/mmdev94/watchtower/data/summary.json
  gh attestation verify summary.json -R mmdev94/watchtower
  ```
- The site's **Verify this data** button does the same in your browser, and **Test from your browser** times the sites from where you are.

## Limits, said plainly

Checks come from GitHub's US runners. GitHub runs schedules "best effort", so missed checks are shown as gaps, never as downtime. The header says *a* miner served the page, not which or how many. Only the home page is checked.

## Add or remove a site

Add the `ms-computer` topic to your repo (and your ms.computer address as its Website), or [open an issue](../../issues/new?template=add-site.yml). To be removed, [open an issue](../../issues/new?template=remove-site.yml) or add your address to `exclude`. The probe identifies itself as `Watchtower/1.0` and sends about 12 requests an hour per site.

## Run it yourself

```bash
pnpm install
pnpm probe --out public/local-data        # one round of checks, written locally
VITE_DATA=/local-data pnpm dev            # the site, reading your local data
pnpm test
```

Fork the repo and the probe runs on its own schedule in your account (Actions are free for public repos).

## License

MIT
