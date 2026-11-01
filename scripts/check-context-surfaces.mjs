#!/usr/bin/env node
/**
 * Keeps the agent surfaces equal to `.context/docs/README.md`.
 *
 * `--write` (npm run export:context) copies the source over every surface.
 * Without it (npm run check:context), the surfaces are compared and the first
 * difference is reported; exit code 1 means a surface drifted, never that the
 * content is wrong.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareSurface, SOURCE, SURFACES } from './context-surfaces.mjs';

const PREVIEW_LENGTH = 96;

/** Reads a file relative to `root`; '' when it does not exist. */
function read(root, path) {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return '';
    }

    throw error;
  }
}

/**
 * Writes or checks the surfaces under `root`.
 *
 * @param {{root: string, write: boolean}} options - Repository root, and whether to write instead of check.
 * @returns {{ok: boolean, messages: string[]}} The outcome and what to print.
 */
export function run({ root, write }) {
  const source = read(root, SOURCE);

  if (source === '') {
    return { ok: false, messages: [`${SOURCE} is missing: it is the source every surface copies.`] };
  }

  if (write) {
    for (const surface of SURFACES) {
      // The directory may be gone: deleting it is how someone recovers from a surface broken by hand.
      mkdirSync(dirname(join(root, surface)), { recursive: true });
      writeFileSync(join(root, surface), source);
    }

    return { ok: true, messages: [`Wrote ${SURFACES.join(', ')} from ${SOURCE}.`] };
  }

  const problems = [];

  for (const surface of SURFACES) {
    const diff = compareSurface(source, read(root, surface));

    if (!diff.equal) {
      problems.push(
        `${surface} is not a copy of ${SOURCE}, line ${diff.line}:\n`
          + `      source:  ${diff.source.trim().slice(0, PREVIEW_LENGTH)}\n`
          + `      surface: ${diff.surface.trim().slice(0, PREVIEW_LENGTH)}`,
      );
    }
  }

  if (problems.length > 0) {
    return {
      ok: false,
      messages: [
        'The agent surfaces drifted from their source:',
        ...problems.map((problem) => `  - ${problem}`),
        'Run `npm run export:context` and commit the result.',
      ],
    };
  }

  return { ok: true, messages: [`OK: ${SURFACES.join(', ')} are copies of ${SOURCE}.`] };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = run({ root: process.cwd(), write: process.argv.includes('--write') });
  const stream = result.ok ? process.stdout : process.stderr;

  stream.write(`${result.messages.join('\n')}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
