/**
 * REQ-033 .. REQ-037 — payload precedence, named examples, `Prefer` parsing, `Preference-Applied`
 * and the `Deprecation` header.
 *
 * Exact bodies are asserted here because the specification prescribes them: these are example
 * passthrough cases, the one place ARCHITECTURE section 4 rule 2 allows a value assertion.
 */

import { describe, expect, it } from 'vitest';
import { PETSTORE, fixture, useServer } from '../helpers/server.js';
import { detailsText, errorBody, request } from '../helpers/http.js';
import { conformsToResponseSchema, documentedExample, documentedSingleExample } from '../helpers/schema.js';

describe('REQ-033 — payload precedence within the selected media type', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const precedence = useServer({ specPath: fixture('payload-precedence.yaml') });

  it('REQ-033: a content-level example is served verbatim and marked X-Mock-Payload: example', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=404' } });
    const expected = await documentedSingleExample(PETSTORE, { path: '/pets/{petId}', status: '404' });
    expect({ body: res.json, payload: res.header('x-mock-payload') }).toEqual({
      body: expected,
      payload: 'example',
    });
  });

  it('REQ-033: with only an examples map, the first entry in document order is served', async () => {
    const res = await request(petstore().url, '/pets/1');
    const expected = await documentedExample(PETSTORE, { path: '/pets/{petId}', name: 'rex' });
    expect({ body: res.json, payload: res.header('x-mock-payload') }).toEqual({
      body: expected,
      payload: 'example',
    });
  });

  it('REQ-033: a content-level example wins over an examples map', async () => {
    const res = await request(precedence().url, '/example-and-examples');
    expect(res.json).toEqual({ p: 'content-example' });
  });

  it('REQ-033: schema.example is used when neither example nor examples is declared', async () => {
    const res = await request(precedence().url, '/schema-example');
    expect({ body: res.json, payload: res.header('x-mock-payload'), seed: res.header('x-mock-seed') }).toEqual({
      body: { p: 'schema-example' },
      payload: 'example',
      seed: undefined,
    });
  });

  it('REQ-033: with no example anywhere, data is generated and marked X-Mock-Payload: generated', async () => {
    const res = await request(petstore().url, '/pets');
    const conformance = await conformsToResponseSchema(PETSTORE, { path: '/pets' }, res.json);
    expect({ valid: conformance.valid, payload: res.header('x-mock-payload'), errors: conformance.errors }).toEqual(
      { valid: true, payload: 'generated', errors: '' },
    );
  });

  it('REQ-033: an example that does not satisfy its own schema is served as-is', async () => {
    const res = await request(precedence().url, '/bad-example');
    expect({ status: res.status, body: res.json }).toEqual({ status: 200, body: { n: 'not-an-integer' } });
  });
});

describe('REQ-034 — Prefer: example=<name> selects a named example', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const byCode = useServer({ specPath: fixture('examples-by-code.yaml') });

  it('REQ-034: a named example is served verbatim', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'example=mittens' } });
    const expected = await documentedExample(PETSTORE, { path: '/pets/{petId}', name: 'mittens' });
    expect({ body: res.json, payload: res.header('x-mock-payload') }).toEqual({
      body: expected,
      payload: 'example',
    });
  });

  it('REQ-034: an unknown example name is 400 / EXAMPLE_NOT_FOUND listing the available names', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'example=nosuch' } });
    const serialised = detailsText(res);
    expect({
      status: res.status,
      code: errorBody(res).code,
      listsRex: serialised.includes('rex'),
      listsMittens: serialised.includes('mittens'),
    }).toEqual({ status: 400, code: 'EXAMPLE_NOT_FOUND', listsRex: true, listsMittens: true });
  });

  it('REQ-034: a media type with no examples map at all is 400 / EXAMPLE_NOT_FOUND', async () => {
    const res = await request(petstore().url, '/pets', { headers: { prefer: 'example=anything' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'EXAMPLE_NOT_FOUND',
    });
  });

  it('REQ-034: code is applied first, so the example is looked up in the preferred response', async () => {
    const path = fixture('examples-by-code.yaml');
    const res = await request(byCode().url, '/pets/1', { headers: { prefer: 'code=404, example=notFound' } });
    const expected = await documentedExample(path, {
      path: '/pets/{petId}',
      status: '404',
      name: 'notFound',
    });
    expect({ status: res.status, body: res.json }).toEqual({ status: 404, body: expected });
  });

  it('REQ-034: example names are matched case-sensitively', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'example=Rex' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'EXAMPLE_NOT_FOUND',
    });
  });
});

describe('REQ-035 — Prefer parsing rules', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const byCode = useServer({ specPath: fixture('examples-by-code.yaml') });

  it('REQ-035: whitespace around directive names and values is tolerated', async () => {
    const res = await request(byCode().url, '/pets/1', {
      headers: { prefer: '  code = 404 ,  example = notFound ' },
    });
    const expected = await documentedExample(fixture('examples-by-code.yaml'), {
      path: '/pets/{petId}',
      status: '404',
      name: 'notFound',
    });
    expect({ status: res.status, body: res.json }).toEqual({ status: 404, body: expected });
  });

  it('REQ-035: directive names are matched case-insensitively', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'Code=404' } });
    expect(res.status).toBe(404);
  });

  it('REQ-035: a surrounding pair of double quotes is stripped from a directive value', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code="404"' } });
    expect(res.status).toBe(404);
  });

  it('REQ-035: an unknown directive is ignored and never an error', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'respond-async, code=404' } });
    expect({ status: res.status, source: res.header('x-mock-source') }).toEqual({
      status: 404,
      source: 'specification',
    });
  });

  it.each([
    ['non-numeric', 'code=abc'],
    ['too few digits', 'code=40'],
    ['too many digits', 'code=1000'],
    ['empty value', 'code='],
    ['below the 100..599 range', 'code=099'],
  ])('REQ-035: a malformed code directive (%s) is 400 / INVALID_PREFER_HEADER', async (_label, prefer) => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'INVALID_PREFER_HEADER',
    });
  });

  it('REQ-035: an empty example directive value is 400 / INVALID_PREFER_HEADER', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'example=' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'INVALID_PREFER_HEADER',
    });
  });

  it('REQ-035: the same known directive twice is 400 / INVALID_PREFER_HEADER', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=200, code=404' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 400,
      code: 'INVALID_PREFER_HEADER',
    });
  });

  it('REQ-035: no Prefer header means default selection and no error', async () => {
    const res = await request(petstore().url, '/pets/1');
    expect(res.status).toBe(200);
  });

  it('REQ-035: an empty Prefer header value means default selection and no error', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: '' } });
    expect(res.status).toBe(200);
  });

  it('REQ-035: request validation is reported before a malformed Prefer header', async () => {
    const res = await request(petstore().url, '/pets/abc', { headers: { prefer: 'code=abc' } });
    expect({ status: res.status, code: errorBody(res).code }).toEqual({
      status: 422,
      code: 'REQUEST_VALIDATION_FAILED',
    });
  });
});

describe('REQ-036 — an applied preference is echoed in Preference-Applied', () => {
  const petstore = useServer({ specPath: PETSTORE });
  const byCode = useServer({ specPath: fixture('examples-by-code.yaml') });

  it('REQ-036: an honoured code directive is echoed', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'code=404' } });
    expect(res.header('preference-applied')).toBe('code=404');
  });

  it('REQ-036: both honoured directives are echoed in the order code, example', async () => {
    const res = await request(byCode().url, '/pets/1', { headers: { prefer: 'example=notFound, code=404' } });
    expect(res.header('preference-applied')).toBe('code=404, example=notFound');
  });

  it('REQ-036: a request with only ignored directives carries no Preference-Applied header', async () => {
    const res = await request(petstore().url, '/pets/1', { headers: { prefer: 'respond-async' } });
    expect({ status: res.status, applied: res.header('preference-applied') }).toEqual({
      status: 200,
      applied: undefined,
    });
  });
});

describe('REQ-037 — a deprecated operation is marked in the response', () => {
  const server = useServer({ specPath: fixture('deprecated.yaml') });

  it('REQ-037: deprecated: true adds Deprecation: true to the ordinary selected response', async () => {
    const res = await request(server().url, '/old');
    expect({ status: res.status, deprecation: res.header('deprecation') }).toEqual({
      status: 200,
      deprecation: 'true',
    });
  });

  it('REQ-037: an operation without deprecated carries no Deprecation header', async () => {
    const res = await request(server().url, '/current');
    expect({ status: res.status, deprecation: res.header('deprecation') }).toEqual({
      status: 200,
      deprecation: undefined,
    });
  });

  it('REQ-037: deprecated: false carries no Deprecation header', async () => {
    const res = await request(server().url, '/explicitly-not-deprecated');
    expect({ status: res.status, deprecation: res.header('deprecation') }).toEqual({
      status: 200,
      deprecation: undefined,
    });
  });
});
