/**
 * Local ESLint rule: consistent blank lines between doc comment tags.
 *
 * Looking only at the blank lines directly before each tag:
 * - two tags of the same group have no blank line between them;
 * - two tags of different groups have exactly one;
 * - two metadata tags (see METADATA_TAGS) have at most one, so a header can be
 *   written compact or spaced.
 *
 * A tag's group is its name after synonyms (`@return` is `@returns`); the
 * metadata tags form one group.
 *
 *   CORRECT                         WRONG
 *   @param a - first                @param a - first
 *   @param b - second
 *                                   @param b - second
 *   @returns the sum                @returns the sum
 *                                   @throws {@link RangeError} when ...
 *
 * Not counted as tag separators:
 * - a blank line inside a tag's description or inside `@example` code: only the
 *   run of blank lines right before the next tag separates two tags;
 * - a line that starts with `@` but is not a tag, such as a scoped package name
 *   (`@scope/package`) or a decorator (`@Injectable()`): a tag name is followed
 *   by whitespace, `{` or the end of the line;
 * - anything inside a fenced code block.
 */

/** Tags that describe the declaration as a whole. One group; one blank line between them is optional. */
const METADATA_TAGS = new Set([
  'abstract',
  'alpha',
  'beta',
  'class',
  'constant',
  'deprecated',
  'description',
  'enum',
  'experimental',
  'extends',
  'implements',
  'interface',
  'internal',
  'module',
  'override',
  'packageDocumentation',
  'private',
  'protected',
  'public',
  'readonly',
  'remarks',
  'sealed',
  'static',
  'type',
  'typedef',
  'virtual',
]);

/**
 * Synonyms mapped to one name. A Map, not an object literal: looking up
 * `constructor` on a plain object finds `Object.prototype.constructor`.
 */
const TAG_ALIASES = new Map([
  ['arg', 'param'],
  ['argument', 'param'],
  ['augments', 'extends'],
  ['const', 'constant'],
  ['desc', 'description'],
  ['exception', 'throws'],
  ['prop', 'property'],
  ['return', 'returns'],
]);

/** A tag at the start of a comment line: `@name` followed by whitespace, `{` or the end of the line. */
const TAG_PATTERN = /^(?:\*\s*)?@([A-Za-z]\w*)(?=[\s{]|$)/;

/** A line that opens or closes a fenced code block. */
const FENCE_PATTERN = /^(?:\*\s*)?```/;

/** The group of a tag: the metadata group, or its own name after synonyms. */
function groupOf(name) {
  const canonical = TAG_ALIASES.get(name) ?? name;

  return METADATA_TAGS.has(canonical) ? 'metadata' : canonical;
}

/** True when a comment line carries nothing but the leading asterisk. */
function isBlankLine(line) {
  const trimmed = line.trim();

  return trimmed === '*' || trimmed === '';
}

/** Every line of the comment that starts a tag, skipping fenced code. */
function findTags(lines) {
  const tags = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    if (FENCE_PATTERN.test(trimmed)) {
      inFence = !inFence;
      continue;
    }

    const match = inFence ? null : TAG_PATTERN.exec(trimmed);

    if (match) {
      tags.push({ index, name: match[1], group: groupOf(match[1]) });
    }
  }

  return tags;
}

/** The indices of the blank lines directly above `next`, nearest first. */
function separatorAbove(lines, previous, next) {
  const separator = [];

  for (let index = next.index - 1; index > previous.index && isBlankLine(lines[index]); index -= 1) {
    separator.push(index);
  }

  return separator;
}

/** Decides whether the spacing between two consecutive tags is wrong, and how to fix it. */
function judge(previous, next, separator) {
  const bothMetadata = previous.group === 'metadata' && next.group === 'metadata';

  if (bothMetadata) {
    return separator.length > 1 ? { messageId: 'extraBlankDiffType', remove: separator.slice(1) } : null;
  }

  if (previous.group === next.group) {
    return separator.length > 0 ? { messageId: 'noBlankSameType', remove: separator } : null;
  }

  if (separator.length === 0) {
    return { messageId: 'missingBlankDiffType', addBefore: next.index };
  }

  // `separator` runs upwards from the tag: keep the line nearest to it.
  return separator.length > 1 ? { messageId: 'extraBlankDiffType', remove: separator.slice(1) } : null;
}

/** Rewrites the whole comment with the blank lines removed and added. */
function rewrite(lines, toRemove, toAddBefore) {
  const result = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (toRemove.has(index)) {
      continue;
    }

    if (toAddBefore.has(index)) {
      result.push(`${/^(\s*)/.exec(lines[index])[1]}*`);
    }

    result.push(lines[index]);
  }

  return `/*${result.join('\n')}*/`;
}

/** Checks one doc comment and reports every spacing violation in it. */
function checkComment(context, comment) {
  const lines = comment.value.split('\n');
  const tags = findTags(lines);
  const toRemove = new Set();
  const toAddBefore = new Set();
  const violations = [];

  for (let position = 1; position < tags.length; position += 1) {
    const previous = tags[position - 1];
    const next = tags[position];
    const verdict = judge(previous, next, separatorAbove(lines, previous, next));

    if (verdict) {
      verdict.remove?.forEach((index) => toRemove.add(index));

      if (verdict.addBefore !== undefined) {
        toAddBefore.add(verdict.addBefore);
      }

      violations.push({ messageId: verdict.messageId, data: { from: previous.name, to: next.name }, lineIndex: next.index });
    }
  }

  // One fix rewrites the whole comment, so every violation in it is corrected in a single pass.
  const fix = (fixer) => fixer.replaceTextRange(comment.range, rewrite(lines, toRemove, toAddBefore));

  for (const violation of violations) {
    const line = comment.loc.start.line + violation.lineIndex;

    context.report({
      loc: { start: { line, column: 0 }, end: { line, column: lines[violation.lineIndex].length } },
      messageId: violation.messageId,
      data: violation.data,
      fix,
    });
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    fixable: 'whitespace',
    docs: {
      description: 'No blank line between doc comment tags of the same group, exactly one between groups.',
    },
    schema: [],
    messages: {
      noBlankSameType: 'No blank lines allowed between consecutive @{{from}} and @{{to}} tags.',
      missingBlankDiffType: 'A blank line is required between @{{from}} and @{{to}}.',
      extraBlankDiffType: 'Only one blank line is allowed between @{{from}} and @{{to}}.',
    },
  },

  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === 'Block' && comment.value.startsWith('*')) {
            checkComment(context, comment);
          }
        }
      },
    };
  },
};
