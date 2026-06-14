/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:             'var(--bg)',
        surface:        'var(--surface)',
        ink:            'var(--ink)',
        'ink-2':        'var(--ink-2)',
        'ink-3':        'var(--ink-3)',
        accent:         'var(--amber)',
        'accent-light': 'var(--amber-light)',
        'accent-dim':   'var(--amber-dim)',
        'c-border':     'var(--border)',
        'c-border-sub': 'var(--border-subtle)',
        'c-green':      'var(--green)',
        'c-green-lt':   'var(--green-light)',
        'c-red':        'var(--red)',
        'c-red-lt':     'var(--red-light)',
        'c-blue':       'var(--blue)',
        'c-blue-lt':    'var(--blue-light)',
      },
      fontFamily: {
        sans:  ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

