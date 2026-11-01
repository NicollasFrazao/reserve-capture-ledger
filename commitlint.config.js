// Conventional Commits, checked by the commit-msg hook and, in CI, on every
// commit of a pull request. The commit type decides the version bump; see
// CONTRIBUTING.md.
export default {
  extends: ['@commitlint/config-conventional'],
};
