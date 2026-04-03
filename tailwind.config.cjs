/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#000000',
          1: '#141313',
          2: '#1e1f20',
          3: '#282a2c',
          4: '#333537',
          5: '#37393b',
        },
        text: {
          primary: '#e5e2e1',
          secondary: '#c4c7c7',
          tertiary: '#8c8c8c',
          muted: '#3e3e3e',
        },
        accent: {
          DEFAULT: '#2483e2',
          hover: '#076eff',
          subtle: 'rgba(36, 131, 226, 0.14)',
          glow: 'rgba(7, 110, 255, 0.10)',
        },
        border: {
          DEFAULT: '#262626',
          subtle: 'rgba(255, 255, 255, 0.06)',
          hover: '#333333',
        },
        status: {
          error: '#ffb4ab',
          success: '#3ddb85',
          warning: '#ffb95c',
        },
        user: {
          bubble: 'rgba(36, 131, 226, 0.10)',
        },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-up': 'slide-up 0.25s ease-out',
        'thinking-dot': 'thinking-dot 1.4s ease-in-out infinite',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'thinking-dot': {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.4' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
