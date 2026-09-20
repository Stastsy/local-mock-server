/**
 * REQ-009 .. REQ-012 — capability checking: which constructs are rejected at load time, how the
 * report is shaped, and which constructs load but are ignored.
 */

import { describe, expect, it } from 'vitest';
import { createServerRejection, fixture, startServer } from '../helpers/server.js';
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
