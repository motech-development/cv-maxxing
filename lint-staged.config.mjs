const codeFiles = '*.{cjs,cts,js,jsx,mjs,mts,ts,tsx}';
const prettierFiles = '*.{css,html,json,jsonc,md,mdx,scss,yaml,yml}';

export default {
  [codeFiles]: ['eslint --max-warnings 0 --fix', 'prettier --write'],
  [prettierFiles]: ['prettier --write --ignore-unknown'],
};
