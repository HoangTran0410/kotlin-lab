import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'engine phải thuần TypeScript, không phụ thuộc UI' },
          { name: 'react-dom', message: 'engine phải thuần TypeScript, không phụ thuộc UI' },
          { name: 'zustand', message: 'engine phải thuần TypeScript, không phụ thuộc UI' },
        ],
        patterns: ['@xyflow/*'],
      }],
      'no-restricted-globals': ['error',
        { name: 'window', message: 'engine không được chạm DOM' },
        { name: 'document', message: 'engine không được chạm DOM' },
        { name: 'setTimeout', message: 'engine dùng thời gian ảo, không ngủ thật' },
      ],
    },
  },
)
