import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/app/**/*.{ts,tsx}', './src/components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b0b12',
        spotlight: '#ffc53d',
        coral: '#ff6b5b',
      },
    },
  },
  plugins: [],
};

export default config;
