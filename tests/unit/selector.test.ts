/**
 * Selection is three independent decisions in a fixed order (status, media type, payload). The
 * acceptance suite observes the outcome; these cases pin the ladders themselves, including the
 * rungs that need a specification shape no fixture happens to have.
 */

import { describe, expect, it } from 'vitest';
import { selectPayload, selectResponse } from '../../src/response/selector.js';
import type { RouteOperation } from '../../src/routing/router.js';
import type { OperationObject } from '../../src/spec/types.js';
import { MockError } from '../../src/errors.js';

function target(operation: OperationObject): RouteOperation {
  return { method: 'get', operation, parameters: [], pointer: '#/paths/~1t/get' };
}

function jsonResponse(payload: Record<string, unknown>): Record<string, unknown> {
  return { description: 'ok', content: { 'application/json': payload } };
}

function codeOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return (error as MockError).code;
  }
  return undefined;
}

describe('status selection', () => {
  it.each([
    ['the lowest 2xx', ['200', '400'], 200],
    ['the lowest 2xx among several', ['400', '202', '201'], 201],
    ['the lowest numeric status when no 2xx is documented', ['500', '404', '301'], 301],
  ])('chooses %s', (_label, statuses, expected) => {
    const responses = Object.fromEntries(statuses.map((status) => [status, { description: status }]));
    expect(selectResponse(target({ responses }), {}).status).toBe(expected);
  });

  it('serves a default-only operation as 200 from the default response', () => {
    const selection = selectResponse(target({ responses: { default: { description: 'd' } } }), {});
    expect({ status: selection.status, key: selection.responseKey }).toEqual({
      status: 200,
      key: 'default',
    });
  });

  it('never chooses default while a numeric status is documented', () => {
    const responses = { default: { description: 'd' }, '404': { description: 'n' } };
    const selection = selectResponse(target({ responses }), {});
    expect(selection.responseKey).toBe('404');
  });

  it('honours a preferred status that is documented', () => {
    const responses = { '200': { description: 'ok' }, '404': { description: 'no' } };
    expect(selectResponse(target({ responses }), { code: 404 }).status).toBe(404);
  });

  it('refuses a preferred status the operation does not document, default included', () => {
    const responses = { '200': { description: 'ok' }, default: { description: 'd' } };
    expect(codeOf(() => selectResponse(target({ responses }), { code: 500 }))).toBe(
      'NO_RESPONSE_FOR_STATUS',
    );
  });
});

describe('media type selection', () => {
  it('prefers application/json wherever it is declared', () => {
    const responses = {
      '200': {
        description: 'ok',
        content: { 'text/plain': {}, 'application/json': {}, 'application/hal+json': {} },
      },
    };
    expect(selectResponse(target({ responses }), {}).mediaType).toBe('application/json');
  });

  it('falls back to the first JSON media type in document order', () => {
    const responses = {
      '200': { description: 'ok', content: { 'text/plain': {}, 'application/hal+json': {}, 'application/problem+json': {} } },
    };
    expect(selectResponse(target({ responses }), {}).mediaType).toBe('application/hal+json');
  });

  it('reports a response with content but no JSON media type', () => {
    const responses = { '200': { description: 'ok', content: { 'application/xml': {} } } };
    expect(codeOf(() => selectResponse(target({ responses }), {}))).toBe('NO_SUPPORTED_MEDIA_TYPE');
  });

  it('treats an empty content map as no content at all', () => {
    const responses = { '204': { description: 'ok', content: {} } };
    expect(selectResponse(target({ responses }), {}).mediaType).toBeUndefined();
  });
});

describe('payload precedence', () => {
  const ladder = {
    example: { p: 'level-1' },
    examples: { first: { value: { p: 'level-2' } }, second: { value: { p: 'other' } } },
    schema: { type: 'object', example: { p: 'level-3' } },
  };

  function planFor(mediaType: Record<string, unknown>, preferences = {}): ReturnType<typeof selectPayload> {
    const responses = { '200': jsonResponse(mediaType) };
    const selection = selectResponse(target({ responses }), preferences);
    return selectPayload(selection, preferences);
  }

  it('level 1 — a content-level example wins over everything below it', () => {
    expect(planFor(ladder)).toMatchObject({ kind: 'example', value: { p: 'level-1' } });
  });

  it('level 2 — the first entry of examples, in document order', () => {
    const { example: _unused, ...rest } = ladder;
    expect(planFor(rest)).toMatchObject({ kind: 'example', value: { p: 'level-2' } });
  });

  it('level 3 — schema.example, with no seed consumed', () => {
    expect(planFor({ schema: ladder.schema })).toMatchObject({
      kind: 'example',
      value: { p: 'level-3' },
    });
  });

  it('level 4 — generation, when no example of any kind is declared', () => {
    const plan = planFor({ schema: { type: 'object' } });
    expect({ kind: plan.kind, schema: plan.schema }).toEqual({ kind: 'generated', schema: { type: 'object' } });
  });

  it('serves an explicit null example rather than falling through to the next level', () => {
    expect(planFor({ example: null, schema: { type: 'object' } })).toMatchObject({
      kind: 'example',
      value: null,
    });
  });

  it('reports no payload at all for a response without content', () => {
    const selection = selectResponse(target({ responses: { '204': { description: 'ok' } } }), {});
    expect(selectPayload(selection, {}).kind).toBe('none');
  });

  it('a named example overrides the ladder', () => {
    expect(planFor(ladder, { example: 'second' })).toMatchObject({ value: { p: 'other' } });
  });

  it('a named example is matched exactly and case-sensitively', () => {
    const responses = { '200': jsonResponse(ladder) };
    const selection = selectResponse(target({ responses }), { example: 'First' });
    expect(codeOf(() => selectPayload(selection, { example: 'First' }))).toBe('EXAMPLE_NOT_FOUND');
  });

  it('a named example against a media type with no examples map is an error, not a fallback', () => {
    const responses = { '200': jsonResponse({ schema: { type: 'object' } }) };
    const selection = selectResponse(target({ responses }), { example: 'any' });
    expect(codeOf(() => selectPayload(selection, { example: 'any' }))).toBe('EXAMPLE_NOT_FOUND');
  });
});
