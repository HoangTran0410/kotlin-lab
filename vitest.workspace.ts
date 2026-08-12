import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    // Engine + lessons: THUẦN Node. Không có DOM global ở đây, cố ý.
    // Nếu engine lỡ chạm window/document, test phải VỠ chứ không im lặng chạy được.
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
