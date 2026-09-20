/**
 * REQ-054 names six components and says the derivation must be a pure function of those six and
 * nothing else. Over HTTP only the consequences are visible; here each component is varied on its
 * own, which is what makes a missing or an extra component diagnosable.
 */

import { describe, expect, it } from 'vitest';
import { effectiveSeed, normaliseQuery, type RequestIdentity } from '../../src/response/seed.js';

const BASE: RequestIdentity = {
  seed: 42,
  method: 'GET',
  path: '/things/1',
  query: '',
  status: 200,
  mediaType: 'application/json',
};

describe('normaliseQuery', () => {
  it('is empty when there is no query string', () => {
    expect(normaliseQuery(new URLSearchParams(''))).toBe('');
  });

  it('sorts by name and then by value, so parameter order does not matter', () => {
    const one = normaliseQuery(new URLSearchParams('limit=1&status=sold'));
    const other = normaliseQuery(new URLSearchParams('status=sold&limit=1'));
    expect([one, other]).toEqual(['limit=1&status=sold', 'limit=1&status=sold']);
  });

  it('keeps repeated parameters, sorted by value', () => {
    expect(normaliseQuery(new URLSearchParams('tag=b&tag=a'))).toBe('tag=a&tag=b');
  });

  it('includes parameters the specification does not declare', () => {
    expect(normaliseQuery(new URLSearchParams('colour=red'))).toBe('colour=red');
  });

  it('works on decoded values, so two encodings of one query agree', () => {
    const plain = normaliseQuery(new URLSearchParams('q=a b'));
    const encoded = normaliseQuery(new URLSearchParams('q=a%20b'));
    expect([plain, encoded]).toEqual(['q=a b', 'q=a b']);
  });
});

describe('effectiveSeed', () => {
  it('is an integer in 0..4294967295', () => {
    const seeds = Array.from({ length: 50 }, (_unused, index) =>
      effectiveSeed({ ...BASE, path: `/things/${index}` }),
    );
    expect(seeds.every((seed) => Number.isInteger(seed) && seed >= 0 && seed <= 4294967295)).toBe(true);
  });

  it('is pure: the same identity always derives the same seed', () => {
    expect(effectiveSeed(BASE)).toBe(effectiveSeed({ ...BASE }));
  });

  it.each([
    ['the configured seed', { seed: 43 }],
    ['the method', { method: 'POST' }],
    ['the path', { path: '/things/2' }],
    ['the query string', { query: 'limit=1' }],
    ['the status', { status: 201 }],
    ['the media type', { mediaType: 'application/hal+json' }],
  ])('changes when %s changes', (_label, change) => {
    expect(effectiveSeed({ ...BASE, ...change })).not.toBe(effectiveSeed(BASE));
  });

  it('uppercases the method, so identity does not depend on how it was written', () => {
    expect(effectiveSeed({ ...BASE, method: 'get' })).toBe(effectiveSeed({ ...BASE, method: 'GET' }));
  });

  it('separates the components, so a shift between two of them is not invisible', () => {
    // Without a separator, ("/a", "b=1") and ("/ab", "=1") would hash to the same material.
    expect(effectiveSeed({ ...BASE, path: '/a', query: 'b=1' })).not.toBe(
      effectiveSeed({ ...BASE, path: '/ab', query: '=1' }),
    );
  });
});
