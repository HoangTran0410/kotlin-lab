import tseslint from 'typescript-eslint'

export default tseslint.config(
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
)
