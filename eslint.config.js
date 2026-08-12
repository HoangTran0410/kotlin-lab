import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Explicit ignores. eslint 9 flat config does NOT ignore dist/ on its own,
  // and 'vite build' writing into it while lint runs caused flaky failures.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.timestamp-*'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // patterns, NOT paths: `paths` matches the module string EXACTLY, so the
      // old boundary missed precisely the import forms people actually write —
      // 'react-dom/client', 'react/jsx-runtime' and 'zustand/middleware' all
      // slipped through. Measured with a probe file under src/engine/ before
      // the fix.
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
            message: 'engine must stay pure TypeScript, no UI dependencies',
          },
          {
            group: ['zustand', 'zustand/*', '@xyflow/*'],
            message: 'engine must stay pure TypeScript, no UI dependencies',
          },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'the engine must not touch the DOM' },
        { name: 'document', message: 'the engine must not touch the DOM' },
        { name: 'setTimeout', message: 'the engine uses virtual time, it never really sleeps' },
      ],
      'no-restricted-syntax': ['error',
        // Nondeterministic sources. The plan's global constraints forbid them,
        // but until now no rule guarded that: no-restricted-globals only matches
        // bare identifiers, so 'Math'/'Date'/'performance' were never reached.
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'the engine must be deterministic: no Math.random',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'the engine uses a virtual clock (VirtualClock), not Date.now',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'the engine uses a virtual clock (VirtualClock), not new Date',
        },
        {
          selector: "MemberExpression[object.name='performance'][property.name='now']",
          message: 'the engine uses a virtual clock (VirtualClock), not performance.now',
        },
        // no-restricted-imports does not look at dynamic imports, so without
        // this line `await import("react")` walks straight through the boundary.
        {
          selector: 'ImportExpression[source.value=/^(react|react-dom|zustand|@xyflow)(\\u002F|$)/]',
          message: 'engine must stay pure TypeScript, no UI dependencies',
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/state/**/*.ts', 'src/lessons/registry.ts'],
    rules: {
      // This code runs in the browser. `src/lessons/index.ts` (node:fs) is
      // DELIBERATELY absent from the list above — it is the Node-test variant.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*', 'fs', 'path', 'url'],
            message: 'UI code runs in the browser, no Node API here' },
          { group: ['**/lessons/index'],
            message: 'use lessons/registry (browser-safe), not lessons/index (node:fs)' },
        ],
      }],
    },
  },
)
