import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/node_modules', '**/dist', '**/.next', '**/coverage', '**/next-env.d.ts'],
  },
  ...tseslint.configs.recommended,
  prettier,
);
