import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from './check-context-surfaces.mjs';
import { compareSurface, SOURCE, SURFACES } from './context-surfaces.mjs';

describe('compareSurface', () => {
  it('accepts an exact copy', () => {
    const text = '# Index\n\nRead the conventions first.\n';

    expect(compareSurface(text, text)).toEqual({ equal: true });
  });

  it('reports the first line that differs, with both sides', () => {
    expect(compareSurface('# Index\n\nCoverage is 80%.\n', '# Index\n\nCoverage is 70%.\n')).toEqual({
      equal: false,
      line: 3,
      source: 'Coverage is 80%.',
      surface: 'Coverage is 70%.',
    });
  });

  it('catches a line missing from the surface, and one left only in it', () => {
    expect(compareSurface('# Index\n\nnew rule\n', '# Index\n')).toMatchObject({ source: 'new rule', surface: '(end of file)' });
    expect(compareSurface('# Index\n', '# Index\n\nold rule\n')).toMatchObject({ source: '(end of file)', surface: 'old rule' });
  });

  it('normalizes nothing: indentation and heading depth count', () => {
    expect(compareSurface('  - child\n', '- child\n').equal).toBe(false);
    expect(compareSurface('## Detail\n', '### Detail\n').equal).toBe(false);
  });
});

describe('the surface list', () => {
  it('names one file per tool and copies the index, not the rules', () => {
    expect(SURFACES).toEqual(['AGENTS.md', '.claude/CLAUDE.md', '.github/copilot-instructions.md']);
    expect(SOURCE).toBe('.context/docs/README.md');
  });
});

describe('check-context-surfaces', () => {
  const roots = [];

  /** A scratch repository with the given files. */
  function repository(files) {
    const root = mkdtempSync(join(tmpdir(), 'surfaces-'));

    roots.push(root);

    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }

    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails without the source', () => {
    expect(run({ root: repository({}), write: false }).ok).toBe(false);
  });

  it('fails when a surface is missing or differs, naming it', () => {
    const root = repository({ [SOURCE]: '# Index\n', 'AGENTS.md': '# Index\n', '.claude/CLAUDE.md': '# Old\n' });
    const result = run({ root, write: false });

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toContain('.claude/CLAUDE.md is not a copy');
    expect(result.messages.join('\n')).toContain('.github/copilot-instructions.md is not a copy');
  });

  it('writes every surface, recreating missing directories, and then passes', () => {
    const root = repository({ [SOURCE]: '# Index\n\nRead the conventions.\n' });

    expect(run({ root, write: true }).ok).toBe(true);
    for (const surface of SURFACES) {
      expect(readFileSync(join(root, surface), 'utf8')).toBe('# Index\n\nRead the conventions.\n');
    }

    expect(run({ root, write: false })).toEqual({
      ok: true,
      messages: ['OK: AGENTS.md, .claude/CLAUDE.md, .github/copilot-instructions.md are copies of .context/docs/README.md.'],
    });
  });
});
