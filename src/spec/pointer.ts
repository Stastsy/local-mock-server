/** RFC 6901 JSON pointers, in the `#/...` form every requirement and test expects. */

import { isRecord } from './types.js';

export function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Builds `#/a/b~1c` from `['a', 'b/c']`. */
export function pointerOf(...tokens: (string | number)[]): string {
  return `#${tokens.map((token) => `/${escapeToken(String(token))}`).join('')}`;
}

/** Appends tokens to an existing `#/...` pointer. */
export function childPointer(parent: string, ...tokens: (string | number)[]): string {
  return `${parent}${tokens.map((token) => `/${escapeToken(String(token))}`).join('')}`;
}

/**
 * Resolves a local `#/...` pointer against the document.
 * Returns `undefined` when any step is missing — which is what makes a `$ref` unresolvable.
 */
export function resolvePointer(document: unknown, pointer: string): unknown {
  if (pointer === '#' || pointer === '') return document;
  if (!pointer.startsWith('#/')) return undefined;

  let node: unknown = document;
  for (const raw of pointer.slice(2).split('/')) {
    const token = unescapeToken(decodeURIComponent(raw));
    if (Array.isArray(node)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= node.length) return undefined;
      node = node[index];
    } else if (isRecord(node)) {
      if (!Object.hasOwn(node, token)) return undefined;
      node = node[token];
    } else {
      return undefined;
    }
  }
  return node;
}
