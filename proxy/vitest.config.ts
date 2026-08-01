import { defineConfig } from 'vitest/config'

// Standalone, unlike the client's — the proxy isn't a Vite project, so
// there's no existing config to extend the way client/vite.config.ts
// does. Vitest works fine against plain TypeScript on its own; this is
// just the minimal config to point it at the right files. See
// 18-Automated Test Coverage.md.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})