import react from '@vitejs/plugin-react'
import { rmSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// What this page may talk to, in one readable line: its own files, the data
// on GitHub (raw files + the public API, for checking signatures) and
// ms.computer sites (only for "test from my browser").
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: https://raw.githubusercontent.com",
  "connect-src 'self' https://raw.githubusercontent.com https://api.github.com https://*.ms.computer",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const csp = (): Plugin => ({
  name: 'watchtower-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// probe output from local runs lives in public/local-* for the dev server; never ship it
const noLocalData = (): Plugin => ({
  name: 'no-local-data',
  apply: 'build',
  closeBundle: () => ['local-data', 'local-demo'].forEach((d) => rmSync(`dist/${d}`, { recursive: true, force: true })),
})

export default defineConfig({
  plugins: [react(), csp(), noLocalData()],
  define: {
    __COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? '').slice(0, 7) || 'local'),
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
    __REPO__: JSON.stringify(process.env.GITHUB_REPOSITORY ?? 'mmdev94/watchtower'),
  },
})
