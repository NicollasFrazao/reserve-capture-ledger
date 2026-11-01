// Fast first filter on commit; the full gate is in CONTRIBUTING.md.
const CONTEXT_FILES = '{.context/docs/README.md,AGENTS.md,.claude/CLAUDE.md,.github/copilot-instructions.md}';

export default {
  '*.{ts,js,mjs,cjs}': 'eslint --max-warnings 0',
  // The check reads the files from disk, so it takes no file arguments.
  [CONTEXT_FILES]: () => 'npm run check:context',
};
