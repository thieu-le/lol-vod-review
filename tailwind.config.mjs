/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Summoner CMD" palette (see Stitch DESIGN.md): tiered blacks, electric
        // blue primary, hextech gold prestige, strict green/red for win/loss.
        ink: '#050505',
        panel: '#0b0b0c',
        raised: '#121214',
        edge: 'rgb(255 255 255 / 0.12)',
        primary: { DEFAULT: '#00d1ff', dim: '#4cd6ff' },
        gold: { DEFAULT: '#c89b3c', bright: '#f0bf5c' },
        win: { DEFAULT: '#28a745', text: '#4ade80' },
        loss: { DEFAULT: '#dc3545', text: '#f87171' },
      },
      fontFamily: {
        heading: ['"Anybody Variable"', 'system-ui', 'sans-serif'],
        label: ['"Space Grotesk Variable"', 'system-ui', 'sans-serif'],
        sans: ['"Inter Variable"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-primary': '0 0 12px rgb(0 209 255 / 0.4)',
        'glow-win': '0 0 14px rgb(40 167 69 / 0.25)',
        'glow-loss': '0 0 14px rgb(220 53 69 / 0.25)',
      },
    },
  },
  plugins: [],
};
