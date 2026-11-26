/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#ffffff',
        bg2: '#f7f8fa',
        ink: '#16161a',
        ink2: '#2b2d35',
        muted: '#696d7e',
        line: '#ccd3dd',
        accent: '#8f63ff',
        accent2: '#6f2a85',
        accentSoft: '#f2ecff',
        dark: '#18191e',
        dark2: '#2b2d35',
        darkline: '#2f313a',
        good: '#0ca30c',
        warn: '#fab219',
        bad: '#d03b3b',
        goodText: '#0a7a0a',
        badText: '#b3302a',
        empty: '#dfe2e8',
      },
      fontFamily: {
        display: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      // websnacks: sharp cards + sections, pill buttons only
      borderRadius: {
        none: '0', sm: '3px', DEFAULT: '0', md: '0', lg: '6px',
        xl: '0', '2xl': '0', '3xl': '0', full: '9999px',
      },
      maxWidth: { shell: '1120px', frame: '1320px', prose: '640px' },
      transitionTimingFunction: { smooth: 'cubic-bezier(0.16,1,0.3,1)' },
    },
  },
  plugins: [],
}
