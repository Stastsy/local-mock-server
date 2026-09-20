/**
 * `$ref` analysis, performed on the document as authored.
 *
 * It runs before validation and before dereferencing because each of the three outcomes it can
 * produce is reported differently: an external reference and a cycle are unsupported constructs
 * (REQ-010), while a dangling internal reference is `SPEC_REF_UNRESOLVABLE` (REQ-005).
 */

import { childPointer, resolvePointer } from './pointer.js';
import { isRecord } from './types.js';
import type { ConstructViolation } from './capabilities.js';

export interface RefOccurrence {
  /** Where the `$ref` member itself lives. */
  pointer: string;
  /** Its raw value. */
  target: string;
}

/** Every `$ref` in the subtree, in document order. */
export function collectRefs(node: unknown, base = '#'): RefOccurrence[] {
  const found: RefOccurrence[] = [];

  const walk = (value: unknown, pointer: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, childPointer(pointer, index)));
      return;
    }
    if (!isRecord(value)) return;

    const ref = value['$ref'];
    if (typeof ref === 'string') found.push({ pointer, target: ref });

    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref') continue;
      walk(child, childPointer(pointer, key));
    }
  };

  walk(node, base);
  return found;
}

export interface RefAnalysis {
  /** External and circular references, as construct violations in document order. */
  violations: ConstructViolation[];
  /** The first internal reference that resolves to nothing, if any. */
  unresolvable: RefOccurrence | undefined;
}

export function analyseRefs(document: unknown): RefAnalysis {
  const occurrences = collectRefs(document);
  const violations: ConstructViolation[] = [];
  let unresolvable: RefOccurrence | undefined;

  for (const occurrence of occurrences) {
    if (!occurrence.target.startsWith('#')) {
      violations.push({ construct: 'externalRef', pointer: occurrence.pointer });
      continue;
    }
    if (unresolvable === undefined && resolvePointer(document, occurrence.target) === undefined) {
      unresolvable = occurrence;
    }
  }

  if (violations.length === 0 && unresolvable === undefined) {
    const cyclic = findCyclicRef(document, occurrences);
    if (cyclic !== undefined) violations.push({ construct: 'circularRef', pointer: cyclic.pointer });
  }

  return { violations, unresolvable };
}

/**
 * Finds the first reference that takes part in a cycle.
 *
 * The graph is over *reference targets*: a target's successors are the targets of every `$ref`
 * inside the subtree it names. A back edge means the document cannot be dereferenced into a
 * finite tree, which is what REQ-010 rejects as `circularRef`.
 */
function findCyclicRef(document: unknown, occurrences: RefOccurrence[]): RefOccurrence | undefined {
  const successors = new Map<string, string[]>();

  const successorsOf = (target: string): string[] => {
    const known = successors.get(target);
    if (known !== undefined) return known;
    const node = resolvePointer(document, target);
    const next = collectRefs(node, target).map((occurrence) => occurrence.target);
    successors.set(target, next);
    return next;
  };

  const settled = new Set<string>();

  const reachesCycle = (target: string, stack: Set<string>): boolean => {
    if (stack.has(target)) return true;
    if (settled.has(target)) return false;
    stack.add(target);
    for (const next of successorsOf(target)) {
      if (reachesCycle(next, stack)) return true;
    }
    stack.delete(target);
    settled.add(target);
    return false;
  };

  for (const occurrence of occurrences) {
    if (reachesCycle(occurrence.target, new Set<string>())) return occurrence;
  }
  return undefined;
}

/**
 * Inlines every internal `$ref`. The document is known to be acyclic and fully resolvable by the
 * time this runs, so the result is a finite tree with no `$ref` left.
 */
export function dereference<T>(document: T): T {
  const resolved = new Map<string, unknown>();

  const expand = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(expand);
    if (!isRecord(node)) return node;

    const ref = node['$ref'];
    if (typeof ref === 'string') {
      const cached = resolved.get(ref);
      if (cached !== undefined) return cached;
      const target = expand(resolvePointer(document, ref));
      resolved.set(ref, target);
      return target;
    }

    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) copy[key] = expand(value);
    return copy;
  };

  return expand(document) as T;
}
