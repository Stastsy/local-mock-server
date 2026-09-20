/**
 * `Prefer` is the only control channel the server offers, and its grammar is stated in REQ-035 as
 * prose. These cases pin the parts of that grammar that an HTTP-level test cannot reach cleanly:
 * repeated field values, quoting, and which malformed inputs are errors rather than noise.
 */

import { describe, expect, it } from 'vitest';
import { parsePrefer } from '../../src/response/prefer.js';
import { MockError } from '../../src/errors.js';

function codeOf(header: string | string[] | undefined): unknown {
  return parsePrefer(header).code;
}

describe('parsePrefer', () => {
  it('returns nothing for an absent or empty header', () => {
    expect([parsePrefer(undefined), parsePrefer(''), parsePrefer('   ')]).toEqual([{}, {}, {}]);
  });

  it('tolerates whitespace around names and values', () => {
    expect(parsePrefer('  code = 404 ,  example = notFound ')).toEqual({
      code: 404,
      example: 'notFound',
    });
  });

  it('matches directive names case-insensitively', () => {
    expect([codeOf('Code=404'), codeOf('CODE=404'), codeOf('cOdE=404')]).toEqual([404, 404, 404]);
  });

  it('strips one surrounding pair of double quotes from a value', () => {
    expect(parsePrefer('code="404", example="a b"')).toEqual({ code: 404, example: 'a b' });
  });

  it('does not strip quotes that are not a surrounding pair', () => {
    expect(parsePrefer('example="unbalanced')).toEqual({ example: '"unbalanced' });
  });

  it('concatenates several field values into one directive list', () => {
    expect(parsePrefer(['code=404', 'example=notFound'])).toEqual({ code: 404, example: 'notFound' });
  });

  it('does not split on a comma inside a quoted value', () => {
    expect(parsePrefer('example="a,b"')).toEqual({ example: 'a,b' });
  });

  it('ignores unknown directives, however many times they appear', () => {
    expect(parsePrefer('respond-async, wait=10, handling=lenient, wait=20, code=404')).toEqual({
      code: 404,
    });
  });

  it.each([
    ['non-numeric', 'code=abc'],
    ['too few digits', 'code=40'],
    ['too many digits', 'code=1000'],
    ['empty', 'code='],
    ['no value at all', 'code'],
    ['below the range', 'code=099'],
    ['a signed value', 'code=+404'],
    ['a fractional value', 'code=40.4'],
  ])('rejects a %s code directive', (_label, header) => {
    expect(() => parsePrefer(header)).toThrow(MockError);
    try {
      parsePrefer(header);
    } catch (error) {
      expect((error as MockError).code).toBe('INVALID_PREFER_HEADER');
    }
  });

  it.each([
    ['an empty example value', 'example='],
    ['a quoted empty example value', 'example=""'],
    ['a repeated code directive', 'code=200, code=404'],
    ['a repeated example directive', 'example=a, example=b'],
  ])('rejects %s', (_label, header) => {
    try {
      parsePrefer(header);
      expect.unreachable('expected parsePrefer to throw');
    } catch (error) {
      expect((error as MockError).code).toBe('INVALID_PREFER_HEADER');
    }
  });

  it('accepts the boundary statuses of the 100..599 range', () => {
    expect([codeOf('code=100'), codeOf('code=599')]).toEqual([100, 599]);
  });
});
