import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    // Engine + lessons: PURE Node. No DOM globals here, deliberately.
    // If the engine ever touches window/document, the tests must BREAK rather
    // than quietly keep working.
    test: {
      name: 'engine',
      globals: true,
      environment: 'node',
      include: ['tests/engine/**/*.test.ts', 'tests/lessons/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'ui',
      globals: true,
      environment: 'jsdom',
      include: ['tests/ui/**/*.test.ts', 'tests/ui/**/*.test.tsx'],
      setupFiles: ['./tests/ui/setup.ts'],
    },
  },
])
