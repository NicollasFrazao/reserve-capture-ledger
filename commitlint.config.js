// Conventional Commits, checked by the commit-msg hook and, in CI, on every
// commit of a pull request. The commit type decides the version bump; see
// CONTRIBUTING.md.
export default {
  extends: ['@commitlint/config-conventional'],
  // Dependabot writes a conventional header but a body of long release-note
  // lines; its commits are machine-made and reviewed in the pull request.
  ignores: [(message) => message.includes('Signed-off-by: dependabot[bot]')],
};
