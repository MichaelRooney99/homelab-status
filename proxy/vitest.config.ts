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
    // Real fix, not a formality — Vitest's default is to exit non-zero
    // when zero test files match, treating "nothing to test" the same
    // as "a test failed." That's correct once 18-'s Phase 2 exists;
    // right now it would fail every CI run (23-) for a reason that has
    // nothing to do with anything actually being broken.
    passWithNoTests: true,
    // db.ts reads this at module-load time to decide where to open its
    // node:sqlite connection — has to be set here, not in the test file
    // itself, since a static `import` in the test file runs before any
    // process.env assignment in that same file could take effect.
    // ':memory:' keeps db.test.ts fully isolated from the real
    // snapshots.db this project actually accumulates production
    // history in.
    env: {
      SNAPSHOTS_DB_PATH: ':memory:',
    },
  },
})
