import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Bỏ qua tường minh. eslint 9 flat config KHÔNG tự bỏ qua dist/, và
  // 'vite build' ghi file vào đó trong lúc lint chạy đã gây đỏ chập chờn.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', '*.timestamp-*'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      // patterns, KHÔNG phải paths: `paths` chỉ khớp ĐÚNG chuỗi module, nên
      // ranh giới cũ không bắt được đúng những dạng import mà người ta thật sự
      // viết — 'react-dom/client', 'react/jsx-runtime', 'zustand/middleware'
      // đều lọt. Đã đo bằng file probe dưới src/engine/ trước khi sửa.
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['react', 'react/*', 'react-dom', 'react-dom/*'],
            message: 'engine phải thuần TypeScript, không phụ thuộc UI',
          },
          {
            group: ['zustand', 'zustand/*', '@xyflow/*'],
            message: 'engine phải thuần TypeScript, không phụ thuộc UI',
          },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'engine không được chạm DOM' },
        { name: 'document', message: 'engine không được chạm DOM' },
        { name: 'setTimeout', message: 'engine dùng thời gian ảo, không ngủ thật' },
      ],
      'no-restricted-syntax': ['error',
        // Nguồn phi tất định. Ràng buộc toàn cục của plan cấm chúng, nhưng trước
        // đây không rule nào canh: no-restricted-globals chỉ khớp định danh trần
        // nên 'Math'/'Date'/'performance' không bao giờ bị chạm tới.
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'engine phải deterministic: không dùng Math.random',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'engine dùng đồng hồ ảo (VirtualClock), không dùng Date.now',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'engine dùng đồng hồ ảo (VirtualClock), không dùng new Date',
        },
        {
          selector: "MemberExpression[object.name='performance'][property.name='now']",
          message: 'engine dùng đồng hồ ảo (VirtualClock), không dùng performance.now',
        },
        // no-restricted-imports không nhìn tới import động, nên không có dòng
        // này thì `await import("react")` đi thẳng qua ranh giới.
        {
          selector: 'ImportExpression[source.value=/^(react|react-dom|zustand|@xyflow)(\\u002F|$)/]',
          message: 'engine phải thuần TypeScript, không phụ thuộc UI',
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/state/**/*.ts', 'src/lessons/registry.ts'],
    rules: {
      // Code này chạy trong browser. `src/lessons/index.ts` (node:fs) CỐ Ý
      // không nằm trong danh sách trên — nó là bản dành cho test Node.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*', 'fs', 'path', 'url'],
            message: 'code UI chạy trong browser, không có Node API' },
          { group: ['**/lessons/index'],
            message: 'dùng lessons/registry (browser-safe), không dùng lessons/index (node:fs)' },
        ],
      }],
    },
  },
)
