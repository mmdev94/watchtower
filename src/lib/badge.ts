// The README badge: "ms.computer | 99.8% up". A plain SVG the probe writes
// next to the data, so a badge is just an image link — no badge service.

const W = (s: string) => Math.round(s.length * 6.6 + 12)

export function badgeColor(up: number | null): string {
  if (up == null) return '#8b8f9c'
  if (up >= 0.99) return '#1fae63'
  if (up >= 0.95) return '#c98a1e'
  return '#d0453a'
}

export function badgeText(up: number | null, isUp: boolean | null): string {
  if (up == null) return 'no data yet'
  const pct = up >= 0.9995 ? '100%' : `${(Math.floor(up * 1000) / 10).toFixed(1)}%`
  return isUp === false ? `down · ${pct} 24h` : `${pct} up 24h`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function badgeSvg(up: number | null, isUp: boolean | null, label = 'ms.computer'): string {
  const right = badgeText(up, isUp)
  const color = isUp === false ? '#d0453a' : badgeColor(up)
  const a = W(label)
  const b = W(right)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a + b}" height="20" role="img" aria-label="${esc(label)}: ${esc(right)}">
<title>${esc(label)}: ${esc(right)} (measured by Watchtower)</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${a + b}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)"><rect width="${a}" height="20" fill="#2b2d35"/><rect x="${a}" width="${b}" height="20" fill="${color}"/><rect width="${a + b}" height="20" fill="url(#s)"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${a / 2}" y="14">${esc(label)}</text><text x="${a + b / 2}" y="14">${esc(right)}</text></g>
</svg>
`
}
