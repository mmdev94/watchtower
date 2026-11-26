// "Is this data really what the probe measured?" Every probe run signs the
// files it writes (actions/attest-build-provenance → Sigstore; GitHub keeps
// the signed record). Here the browser hashes the exact bytes it downloaded
// and asks GitHub's public API for a signed record of that hash.

export interface Verdict {
  state: 'signed' | 'unsigned' | 'error'
  sha256: string
  /** from the signed statement */
  runUrl?: string
  workflow?: string
  commit?: string
  note?: string
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

interface Statement {
  predicate?: {
    buildDefinition?: {
      externalParameters?: { workflow?: { path?: string } }
      resolvedDependencies?: { digest?: { gitCommit?: string } }[]
    }
    runDetails?: { metadata?: { invocationId?: string } }
  }
}

export function readStatement(bundle: unknown): Pick<Verdict, 'commit' | 'runUrl' | 'workflow'> {
  try {
    const payload = (bundle as { dsseEnvelope?: { payload?: string } })?.dsseEnvelope?.payload
    if (!payload) return {}
    const st = JSON.parse(atob(payload)) as Statement
    const bd = st.predicate?.buildDefinition
    return {
      commit: bd?.resolvedDependencies?.[0]?.digest?.gitCommit,
      runUrl: st.predicate?.runDetails?.metadata?.invocationId,
      workflow: bd?.externalParameters?.workflow?.path,
    }
  } catch {
    return {}
  }
}

export async function verifyText(repo: string, text: string, fetchImpl: typeof fetch = fetch): Promise<Verdict> {
  const sha256 = await sha256Hex(text)
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/attestations/sha256:${sha256}`, { headers: { Accept: 'application/vnd.github+json' } })
    if (res.status === 404) return { state: 'unsigned', sha256 }
    if (res.status === 403 || res.status === 429)
      return { state: 'error', sha256, note: 'GitHub’s hourly limit for its API is used up for your network (GitHub’s rule). Try again later, or use the command below.' }
    if (!res.ok) return { state: 'error', sha256, note: `GitHub answered ${res.status}.` }
    const data = (await res.json()) as { attestations?: { bundle?: unknown }[] }
    const first = data.attestations?.[0]
    if (!first) return { state: 'unsigned', sha256 }
    return { state: 'signed', sha256, ...readStatement(first.bundle) }
  } catch (e) {
    return { state: 'error', sha256, note: (e as Error).message }
  }
}

export const verifyCommand = (dataUrl: string, repo: string) =>
  `curl -sO ${dataUrl}/summary.json && gh attestation verify summary.json -R ${repo}`
