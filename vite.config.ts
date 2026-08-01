import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Vitest reads this same config directly — no separate vitest.config.ts
  // needed client-side, unlike the proxy (which has no Vite to share
  // with). See 18-Automated Test Coverage.md.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})