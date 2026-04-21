import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        apex: {
          bg:      '#0B0F19',
          card:    '#151C2C',
          border:  '#1E2D45',
          green:   '#00E676',
          red:     '#FF1744',
          yellow:  '#FFD600',
          blue:    '#2563EB',
          purple:  '#7C3AED',
          amber:   '#F59E0B',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
