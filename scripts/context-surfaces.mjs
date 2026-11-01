/**
 * The agent surfaces are byte-for-byte copies of `.context/docs/README.md`.
 *
 * That file is the index of the context base and, at the top, tells an agent
 * to read the conventions before editing. The rules themselves are not copied:
 * a surface that sends the agent to them costs one read and keeps a single
 * place to change them. Copying is the whole generation step, so there is no
 * template engine and no dependency here.
 */

/** Where each tool looks for its instructions. */
export const SURFACES = ['AGENTS.md', '.claude/CLAUDE.md', '.github/copilot-instructions.md'];

/** The file every surface is a copy of. */
export const SOURCE = '.context/docs/README.md';

/**
 * Compares a surface with the source, line by line, without normalizing anything.
 *
 * @param {string} source - Contents of the source file.
 * @param {string} surface - Contents of a surface.
 * @returns {{equal: true} | {equal: false, line: number, source: string, surface: string}} The first difference, if any.
 */
export function compareSurface(source, surface) {
  const sourceLines = source.split('\n');
  const surfaceLines = surface.split('\n');
  const length = Math.max(sourceLines.length, surfaceLines.length);

  for (let index = 0; index < length; index += 1) {
    if (sourceLines[index] !== surfaceLines[index]) {
      return {
        equal: false,
        line: index + 1,
        source: sourceLines[index] ?? '(end of file)',
        surface: surfaceLines[index] ?? '(end of file)',
      };
    }
  }

  return { equal: true };
}
