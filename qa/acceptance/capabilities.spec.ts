/**
 * REQ-009 .. REQ-012 — capability checking: which constructs are rejected at load time, how the
 * report is shaped, and which constructs load but are ignored.
 */

import { describe, expect, it } from 'vitest';
import { create, createServerRejection, fixture, startServer } from '../helpers/server.js';
import { request } from '../helpers/http.js';
import { conformsToResponseSchema } from '../helpers/schema.js';

interface ConstructDetail {
  construct?: unknown;
  pointer?: unknown;
}

function details(error: { details?: unknown }): ConstructDetail[] {
  return Array.isArray(error.details) ? (error.details as ConstructDetail[]) : [];
}

describe('REQ-009 — unsupported constructs are rejected at load time with a structured report', () => {
  it('REQ-009: rejects with UNSUPPORTED_CONSTRUCT', async () => {
    const error = await createServerRejection({ specPath: fixture('unsupported-cookie-parameter.yaml') });
    expect(error.code).toBe('UNSUPPORTED_CONSTRUCT');
  });

  it('REQ-009: details is a non-empty array of {construct, pointer} objects', async () => {
    const error = await createServerRejection({ specPath: fixture('unsupported-cookie-parameter.yaml') });
    const entries = details(error);
    expect({
      nonEmpty: entries.length > 0,
      wellShaped: entries.every(
        (entry) =>
          typeof entry.construct === 'string' &&
          entry.construct.length > 0 &&
          typeof entry.pointer === 'string' &&
          entry.pointer.startsWith('#/'),
      ),
    }).toEqual({ nonEmpty: true, wellShaped: true });
  });

  it('REQ-009: MockError.pointer equals details[0].pointer', async () => {
    const error = await createServerRejection({ specPath: fixture('unsupported-response-code-range.yaml') });
    expect(error.pointer).toBe(details(error)[0]?.pointer);
  });

  // Scope of the check. The four tests below are one family of fixtures carrying the same
  // `in: cookie` parameter in three positions: unreferenced under `components`
  // (`reachability-unreferenced-cookie-parameter.yaml`), reached from an operation through `$ref`
  // (`reachability-referenced-cookie-parameter.yaml`, the first document plus one line), and
  // declared inline on the operation (`unsupported-cookie-parameter.yaml`, the control). Only the
  // position differs, so the difference in outcome can only be the reachability rule.
  it('REQ-009: a rejected construct in an unreferenced component does not fail the load', async () => {
    const server = await create({
      specPath: fixture('reachability-unreferenced-cookie-parameter.yaml'),
      port: 0,
    });
    await server.stop();
    expect(server.address).toBeUndefined();
  });

  it('REQ-009: that document is served exactly as with the unreferenced component absent', async () => {
    // `reachability-baseline.yaml` is the same document with the `components` block deleted. The
    // request identity of REQ-054 does not include the document, so under one seed the two servers
    // must agree on status, effective seed and body, byte for byte.
    const present = await startServer({
      specPath: fixture('reachability-unreferenced-cookie-parameter.yaml'),
      seed: 7,
    });
    const absent = await startServer({ specPath: fixture('reachability-baseline.yaml'), seed: 7 });
    try {
      const here = await request(present.url, '/pets');
      const there = await request(absent.url, '/pets');
      expect({
        statuses: [here.status, there.status],
        payload: here.header('x-mock-payload'),
        sameSeed: here.header('x-mock-seed') === there.header('x-mock-seed'),
        sameBody: here.text === there.text,
      }).toEqual({ statuses: [200, 200], payload: 'generated', sameSeed: true, sameBody: true });
    } finally {
      // `allSettled`, so that one failing stop can neither skip the other nor mask a failed
      // assertion from the try block with an error of its own.
      await Promise.allSettled([present.stop(), absent.stop()]);
    }
  });

  it('REQ-009: the same component reached from an operation through $ref is rejected', async () => {
    const error = await createServerRejection({
      specPath: fixture('reachability-referenced-cookie-parameter.yaml'),
    });
    expect({ code: error.code, tokens: details(error).map((entry) => entry.construct) }).toEqual({
      code: 'UNSUPPORTED_CONSTRUCT',
      tokens: ['cookieParameter'],
    });
  });

  it('REQ-009: one reference from one operation out of several is enough to reject', async () => {
    const error = await createServerRejection({
      specPath: fixture('reachability-referenced-by-one-operation.yaml'),
    });
    expect({ code: error.code, tokens: details(error).map((entry) => entry.construct) }).toEqual({
      code: 'UNSUPPORTED_CONSTRUCT',
      tokens: ['cookieParameter'],
    });
  });

  it('REQ-009: the control case — the same parameter declared inline on an operation is rejected', async () => {
    const error = await createServerRejection({ specPath: fixture('unsupported-cookie-parameter.yaml') });
    expect({ code: error.code, tokens: details(error).map((entry) => entry.construct) }).toEqual({
      code: 'UNSUPPORTED_CONSTRUCT',
      tokens: ['cookieParameter'],
    });
  });
});

describe('REQ-010 — the rejected constructs and their tokens', () => {
  it.each([
    ['externalRef', 'unsupported-external-ref.yaml'],
    ['circularRef', 'unsupported-circular-ref.yaml'],
    ['cookieParameter', 'unsupported-cookie-parameter.yaml'],
    ['parameterContent', 'unsupported-parameter-content.yaml'],
    ['parameterStyle', 'unsupported-parameter-style.yaml'],
    ['responseCodeRange', 'unsupported-response-code-range.yaml'],
    ['externalValue', 'unsupported-external-value.yaml'],
    ['nonJsonRequestBody', 'unsupported-non-json-request-body.yaml'],
  ])('REQ-010: reports construct token %s', async (token, file) => {
    const error = await createServerRejection({ specPath: fixture(file) });
    expect({
      code: error.code,
      tokens: details(error).map((entry) => entry.construct),
    }).toEqual({ code: 'UNSUPPORTED_CONSTRUCT', tokens: [token] });
  });

  it('REQ-010: a cookie parameter reached through $ref reports cookieParameter with a pointer', async () => {
    const error = await createServerRejection({
      specPath: fixture('reachability-referenced-cookie-parameter.yaml'),
    });
    const first = details(error)[0];
    const pointer = typeof first?.pointer === 'string' ? first.pointer : '';
    expect({
      code: error.code,
      tokens: details(error).map((entry) => entry.construct),
      // REQ-010 asks that the pointer "locates the parameter as the operation reaches it", which
      // reads equally well as the operation's parameter slot or as the component's own location.
      // The assertion pins what both readings require rather than choosing one; the ambiguity is
      // recorded in docs/TEST-PLAN.md section 6.
      locatesAParameter: pointer.startsWith('#/') && pointer.includes('/parameters/'),
    }).toEqual({
      code: 'UNSUPPORTED_CONSTRUCT',
      tokens: ['cookieParameter'],
      locatesAParameter: true,
    });
  });

  // The five tokens REQ-009 scopes by reachability. Each fixture parks the construct in a
  // `components` member that nothing under `paths` references and serves one ordinary operation,
  // so a failure names the one token whose check is not scoped.
  it.each([
    ['cookieParameter', 'reachability-unreferenced-cookie-parameter.yaml'],
    ['parameterContent', 'reachability-unreferenced-parameter-content.yaml'],
    ['parameterStyle', 'reachability-unreferenced-parameter-style.yaml'],
    ['externalValue', 'reachability-unreferenced-external-value.yaml'],
    ['nonJsonRequestBody', 'reachability-unreferenced-non-json-request-body.yaml'],
  ])('REQ-010: %s in an unreferenced component loads and the document is served', async (_token, file) => {
    const path = fixture(file);
    const server = await startServer({ specPath: path });
    try {
      const res = await request(server.url, '/pets');
      const conformance = await conformsToResponseSchema(path, { path: '/pets' }, res.json);
      expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
        status: 200,
        valid: true,
        errors: '',
      });
    } finally {
      await server.stop();
    }
  });

  // The two exceptions: properties of the `$ref` graph, so they are rejected wherever they sit.
  it.each([
    ['externalRef', 'reachability-unreferenced-external-ref.yaml'],
    ['circularRef', 'reachability-unreferenced-circular-ref.yaml'],
  ])('REQ-010: %s is rejected even in a component nothing references', async (token, file) => {
    const error = await createServerRejection({ specPath: fixture(file) });
    expect({
      code: error.code,
      tokens: details(error).map((entry) => entry.construct),
    }).toEqual({ code: 'UNSUPPORTED_CONSTRUCT', tokens: [token] });
  });
});

describe('REQ-011 — all unsupported constructs are reported in one error', () => {
  it('REQ-011: reports three distinct occurrences in one rejection, each with its own pointer', async () => {
    const error = await createServerRejection({ specPath: fixture('unsupported-three.yaml') });
    const entries = details(error);
    expect({
      code: error.code,
      count: entries.length,
      distinctPointers: new Set(entries.map((entry) => entry.pointer)).size,
    }).toEqual({ code: 'UNSUPPORTED_CONSTRUCT', count: 3, distinctPointers: 3 });
  });

  it('REQ-011: reports the occurrences in document order', async () => {
    const error = await createServerRejection({ specPath: fixture('unsupported-three.yaml') });
    expect(details(error).map((entry) => entry.construct)).toEqual([
      'cookieParameter',
      'responseCodeRange',
      'externalValue',
    ]);
  });
});

describe('REQ-012 — accepted-but-ignored constructs never fail the load', () => {
  it('REQ-012: an operation with security is served without credentials', async () => {
    const server = await startServer({ specPath: fixture('ignored-security.yaml') });
    try {
      const res = await request(server.url, '/secret');
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('REQ-012: an operation declaring callbacks loads and is served normally', async () => {
    const server = await startServer({ specPath: fixture('ignored-callbacks.yaml') });
    try {
      const res = await request(server.url, '/subscribe', { method: 'POST' });
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('REQ-012: documented response headers and links are not emitted', async () => {
    const server = await startServer({ specPath: fixture('ignored-response-headers-links.yaml') });
    try {
      const res = await request(server.url, '/pets');
      expect({
        status: res.status,
        rateLimit: res.header('x-rate-limit'),
        link: res.header('link'),
      }).toEqual({ status: 200, rateLimit: undefined, link: undefined });
    } finally {
      await server.stop();
    }
  });

  it('REQ-012: a schema with a discriminator loads and still generates a conforming body', async () => {
    const path = fixture('ignored-discriminator.yaml');
    const server = await startServer({ specPath: path });
    try {
      const res = await request(server.url, '/animals');
      const conformance = await conformsToResponseSchema(path, { path: '/animals' }, res.json);
      expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
        status: 200,
        valid: true,
        errors: '',
      });
    } finally {
      await server.stop();
    }
  });

  it('REQ-012: an operation marked deprecated loads and is served normally', async () => {
    const server = await startServer({ specPath: fixture('deprecated.yaml') });
    try {
      const res = await request(server.url, '/old');
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('REQ-012: path-item and operation servers entries have no effect on routing', async () => {
    const server = await startServer({ specPath: fixture('servers-path-item.yaml') });
    try {
      const atRoot = await request(server.url, '/pets');
      const atV2 = await request(server.url, '/v2/pets');
      expect({ atRoot: atRoot.status, atV2: atV2.status }).toEqual({ atRoot: 200, atV2: 404 });
    } finally {
      await server.stop();
    }
  });

  it('REQ-012: vendor extension keys anywhere in the document leave behaviour unchanged', async () => {
    const path = fixture('ignored-extensions.yaml');
    const server = await startServer({ specPath: path });
    try {
      const res = await request(server.url, '/pets');
      const conformance = await conformsToResponseSchema(path, { path: '/pets' }, res.json);
      expect({ status: res.status, valid: conformance.valid }).toEqual({ status: 200, valid: true });
    } finally {
      await server.stop();
    }
  });
});
