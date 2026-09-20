/**
 * REQ-018 — the base path comes from the path component of `servers[0].url`, by these six rules
 * and no others. Every branch here is a load-time decision; none of them is ever an error.
 */

import { isRecord, type ServerObject } from './types.js';

/** An arbitrary base used only to give a relative `servers[0].url` something to be relative to. */
const RELATIVE_BASE = 'http://base.invalid';

export function deriveBasePath(servers: unknown): string {
  // Rule 2: absent or empty `servers` means no base path.
  if (!Array.isArray(servers) || servers.length === 0) return '';

  // Rule 1: only the first entry is ever considered.
  const first: unknown = servers[0];
  if (!isRecord(first)) return '';

  const url = (first as ServerObject).url;
  // Rule 6: a `url` that is not a string is ignored.
  if (typeof url !== 'string') return '';

  // Rule 3: a templated URL is ignored in full — `variables` defaults are never substituted.
  if (url.includes('{') || url.includes('}')) return '';

  const pathname = pathComponentOf(url);
  // Rule 6: an unparseable URL is ignored, and is never a load-time error.
  if (pathname === undefined) return '';

  // Rule 5: trailing slashes are stripped, so `/` collapses to empty.
  let basePath = pathname;
  while (basePath.endsWith('/')) basePath = basePath.slice(0, -1);
  if (basePath === '') return '';
  return basePath.startsWith('/') ? basePath : `/${basePath}`;
}

/** Rule 4: the path component, from an absolute or a relative URL; query and fragment ignored. */
function pathComponentOf(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    try {
      return new URL(url, RELATIVE_BASE).pathname;
    } catch {
      return undefined;
    }
  }
}
