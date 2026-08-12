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
  // with).
  //
  // environment: 'jsdom' rather than 'node' — needed for Phase 3's
  // component/integration tests (rendering into a real DOM, simulating
  // clicks and keyboard events), and works fine for the existing pure-
  // logic tests too since jsdom is a strict superset of what 'node'
  // provides. setupFiles wires up jest-dom's matchers globally so every
  // test file gets toBeInTheDocument()/etc. without a per-file import.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})