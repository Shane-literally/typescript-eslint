import rule from '../../src/rules/no-unused-exports';
import { RuleTester, getFixturesRootDir } from '../RuleTester';

const rootDir = getFixturesRootDir();
const ruleTester = new RuleTester({
  parserOptions: {
    project: './tsconfig.json',
    tsconfigRootDir: rootDir,
  },
  parser: '@typescript-eslint/parser',
});

ruleTester.run('no-unused-exports', rule, {
  valid: [
    'let used = true;',
    {
      code: 'export const a = true;',
      only: true,
    },
  ],

  invalid: [
    {
      code: 'export let used = true;',
      errors: [
        {
          column: 1,
          endColumn: 7,
          line: 1,
          messageId: 'exportNeverUsed',
          suggestions: [
            {
              messageId: 'suggestRemovingExport',
              output: 'let used = true;',
            },
          ],
        },
      ],
    },
  ],
});
