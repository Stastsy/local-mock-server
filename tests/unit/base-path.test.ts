/**
 * REQ-018 has six rules and the acceptance suite exercises them through fixtures, one server per
 * shape. These cases cover the inputs that are awkward to express as a fixture — a query string, a
 * fragment, several trailing slashes, a non-string `url` — where a wrong answer would otherwise
 * only surface as a puzzling 404.
 */

import { describe, expect, it } from 'vitest';
import { deriveBasePath } from '../../src/spec/base-path.js';

describe('deriveBasePath', () => {
  it.each([
    ['absent', undefined, ''],
    ['not an array', {}, ''],
    ['empty', [], ''],
    ['an entry that is not an object', ['/v1'], ''],
    ['a url that is not a string', [{ url: 42 }], ''],
    ['a url that is missing', [{}], ''],
  ])('rule 1/2/6 — %s yields no base path', (_label, servers, expected) => {
    expect(deriveBasePath(servers)).toBe(expected);
  });

  it.each([
    ['an absolute url', 'https://api.example.com/v1', '/v1'],
    ['a relative url', '/v1', '/v1'],
    ['a nested path', 'https://api.example.com/api/v2', '/api/v2'],
    ['no path component', 'http://localhost:4010', ''],
    ['a path component of exactly /', 'http://localhost:4010/', ''],
    ['one trailing slash', 'https://api.example.com/v1/', '/v1'],
    ['several trailing slashes', 'https://api.example.com/v1///', '/v1'],
    ['a query string', 'https://api.example.com/v1?debug=1', '/v1'],
    ['a fragment', 'https://api.example.com/v1#here', '/v1'],
    ['a relative url without a leading slash', 'v1', '/v1'],
  ])('rule 4/5 — %s', (_label, url, expected) => {
    expect(deriveBasePath([{ url }])).toBe(expected);
  });

  it.each([
    ['https://{tenant}.example.com/v1'],
    ['https://api.example.com/{version}'],
    ['{scheme}://api.example.com/v1'],
  ])('rule 3 — the templated url %s is ignored in full', (url) => {
    expect(deriveBasePath([{ url }])).toBe('');
  });

  it.each([['http://['], ['http://a b'], ['http://%']])(
    'rule 6 — the unparseable url %s is ignored rather than rejected',
    (url) => {
      expect(deriveBasePath([{ url }])).toBe('');
    },
  );

  it('rule 1 — entries after the first are never consulted', () => {
    expect(deriveBasePath([{ url: 'https://a.example.com/v1' }, { url: 'https://b.example.com/v2' }])).toBe(
      '/v1',
    );
  });
});
