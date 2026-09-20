/**
 * REQ-054 — the effective seed is derived from the configured seed together with the identity of
 * the request, and from nothing else.
 *
 * The derivation is a pure function of the six components listed below: no clock, no counter, no
 * process id, no request ordering, no random source. That is what makes two identical requests —
 * in the same process or in another one — return byte-identical bodies (REQ-052), while two
 * different requests to the same operation are independent draws.
 */

import { createHash } from 'node:crypto';

export interface RequestIdentity {
  /** 1 — the configured seed. */
  seed: number;
  /** 2 — the HTTP method, uppercased. */
  method: string;
  /** 3 — the request path, percent-decoded, case-sensitive. */
  path: string;
  /** 4 — the normalised query string; empty when there is none. */
  query: string;
  /** 5 — the selected status code, as served. */
  status: number;
  /** 6 — the selected media type, as served. */
  mediaType: string;
}

/**
 * REQ-054 component 4: every supplied parameter — declared or not — as `name=value`, sorted by
 * name and then by value, joined with `&`. Parameter order is therefore not part of the identity.
 */
export function normaliseQuery(query: URLSearchParams): string {
  return [...query.entries()]
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? compare(leftValue, rightValue)
        : compare(leftName, rightName),
    )
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** An integer in `0..4294967295`, published as `X-Mock-Seed`. */
export function effectiveSeed(identity: RequestIdentity): number {
  const material = [
    String(identity.seed),
    identity.method.toUpperCase(),
    identity.path,
    identity.query,
    String(identity.status),
    identity.mediaType,
  ].join('\n');

  return createHash('sha256').update(material, 'utf8').digest().readUInt32BE(0);
}
