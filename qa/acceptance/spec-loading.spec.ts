/**
 * REQ-001 .. REQ-008 — specification loading, configuration, fail-fast and error shape.
 *
 * Every criterion here is about `createServer` itself, so most tests inspect the rejection value
 * rather than an HTTP response. Where a port is involved it is a port this test reserved, so the
 * "no port was bound" assertions cannot be confused with another worker's listener.
 */

import { afterAll, describe, expect, it } from 'vitest';
import {
  PETSTORE,
  create,
  createServerRejection,
  example,
  fixture,
  startServer,
  type ServerConfig,
} from '../helpers/server.js';
import { request, serialise } from '../helpers/http.js';
import { conformsToResponseSchema, documentedExample } from '../helpers/schema.js';
import { freePort, portAccepts, withDefaultPortLock } from '../helpers/net.js';
import {
  cleanupSpecFiles,
  makeDirectory,
  minimalDocument,
  writeSpecJson,
  writeSpecText,
} from '../helpers/spec-file.js';

afterAll(() => cleanupSpecFiles());

const LOAD_TIME_CODES = [
  'CONFIG_INVALID',
  'SPEC_NOT_FOUND',
  'SPEC_UNREADABLE',
  'UNSUPPORTED_SPEC_VERSION',
  'SPEC_INVALID',
  'SPEC_REF_UNRESOLVABLE',
  'UNSUPPORTED_CONSTRUCT',
];

describe('REQ-001 — the specification file must exist and be readable', () => {
  it('REQ-001: rejects with SPEC_NOT_FOUND when specPath does not exist', async () => {
    const error = await createServerRejection({ specPath: fixture('does-not-exist.yaml') });
    expect(error.code).toBe('SPEC_NOT_FOUND');
  });

  it('REQ-001: rejects with SPEC_UNREADABLE when specPath is a directory', async () => {
    const error = await createServerRejection({ specPath: makeDirectory() });
    expect(error.code).toBe('SPEC_UNREADABLE');
  });

  it('REQ-001: rejects with SPEC_UNREADABLE when the contents are neither YAML nor JSON', async () => {
    const path = writeSpecText('garbage.yaml', '{"openapi": [3.0.3,\n\t- broken: "unterminated\n');
    const error = await createServerRejection({ specPath: path });
    expect(error.code).toBe('SPEC_UNREADABLE');
  });

  it('REQ-001: binds no TCP port when the specification cannot be read', async () => {
    const port = await freePort();
    await createServerRejection({ specPath: fixture('does-not-exist.yaml'), port });
    expect(await portAccepts(port)).toBe(false);
  });
});

describe('REQ-002 — YAML and JSON specifications are both accepted', () => {
  it('REQ-002: serves GET /pets from the YAML petstore', async () => {
    const server = await startServer({ specPath: PETSTORE });
    try {
      const res = await request(server.url, '/pets');
      expect(res.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('REQ-002: serves GET /pets from the JSON equivalent saved with a non-JSON extension', async () => {
    const server = await startServer({ specPath: fixture('petstore-as-json.txt') });
    try {
      const res = await request(server.url, '/pets');
      const conformance = await conformsToResponseSchema(PETSTORE, { path: '/pets' }, res.json);
      expect({ status: res.status, valid: conformance.valid, errors: conformance.errors }).toEqual({
        status: 200,
        valid: true,
        errors: '',
      });
    } finally {
      await server.stop();
    }
  });
});

describe('REQ-003 — only OpenAPI 3.0.x is accepted', () => {
  it.each(['3.0.0', '3.0.1', '3.0.2', '3.0.3', '3.0.4'])(
    'REQ-003: resolves for a document declaring openapi %s',
    async (version) => {
      const path = writeSpecJson(`openapi-${version}.json`, minimalDocument({ openapi: version }));
      const server = await create({ specPath: path, port: 0 });
      try {
        expect(server.address).toBeUndefined();
      } finally {
        await server.stop();
      }
    },
  );

  it('REQ-003: rejects a 3.1.0 document with UNSUPPORTED_SPEC_VERSION naming the detected version', async () => {
    const path = writeSpecJson('openapi-310.json', minimalDocument({ openapi: '3.1.0' }));
    const error = await createServerRejection({ specPath: path });
    expect({ code: error.code, mentions: serialise(error.details).includes('3.1.0') }).toEqual({
      code: 'UNSUPPORTED_SPEC_VERSION',
      mentions: true,
    });
  });

  it('REQ-003: rejects a Swagger 2.0 document with UNSUPPORTED_SPEC_VERSION naming 2.0', async () => {
    const document = minimalDocument();
    delete document.openapi;
    document.swagger = '2.0';
    const path = writeSpecJson('swagger-20.json', document);
    const error = await createServerRejection({ specPath: path });
    expect({ code: error.code, mentions: serialise(error.details).includes('2.0') }).toEqual({
      code: 'UNSUPPORTED_SPEC_VERSION',
      mentions: true,
    });
  });

  it('REQ-003: rejects openapi 4.0.0 with UNSUPPORTED_SPEC_VERSION', async () => {
    const path = writeSpecJson('openapi-400.json', minimalDocument({ openapi: '4.0.0' }));
    const error = await createServerRejection({ specPath: path });
    expect(error.code).toBe('UNSUPPORTED_SPEC_VERSION');
  });

  it('REQ-003: rejects an openapi value that is not a string matching 3.0.<digits>', async () => {
    const path = writeSpecJson('openapi-not-a-string.json', minimalDocument({ openapi: 3.0 }));
    const error = await createServerRejection({ specPath: path });
    expect(error.code).toBe('UNSUPPORTED_SPEC_VERSION');
  });

  it('REQ-003: rejects a document with neither an openapi nor a swagger root key', async () => {
    const document = minimalDocument();
    delete document.openapi;
    const path = writeSpecJson('no-version-key.json', document);
    const error = await createServerRejection({ specPath: path });
    expect(error.code).toBe('UNSUPPORTED_SPEC_VERSION');
  });

  it('REQ-003: reports the version before validation and capability checking', async () => {
    // A 3.1.0 document that is also structurally invalid and carries a rejected construct: the
    // version gate must still be the one that fires.
    const document = minimalDocument({ openapi: '3.1.0', webhooks: { created: {} } });
    (document.paths as Record<string, Record<string, Record<string, unknown>>>)['/ping']!['get']![
      'parameters'
    ] = [{ name: 'session', in: 'cookie', schema: { type: 'string' } }];
    const path = writeSpecJson('openapi-310-also-broken.json', document);
    const error = await createServerRejection({ specPath: path });
    expect(error.code).toBe('UNSUPPORTED_SPEC_VERSION');
  });
});

describe('REQ-004 — the document must be a valid OpenAPI 3.0 document', () => {
  it.each([
    ['an operation with no responses', 'invalid-no-responses.yaml'],
    ['a paths key not beginning with a slash', 'invalid-path-key.yaml'],
    ['an unknown root field (webhooks)', 'invalid-webhooks.yaml'],
  ])('REQ-004: rejects %s with SPEC_INVALID', async (_label, file) => {
    const error = await createServerRejection({ specPath: fixture(file) });
    expect(error.code).toBe('SPEC_INVALID');
  });

  it('REQ-004: rejects two path templates differing only in their variable names', async () => {
    const error = await createServerRejection({ specPath: fixture('invalid-duplicate-template.yaml') });
    expect(error.code).toBe('SPEC_INVALID');
  });

  it('REQ-004: tolerates example and examples on the same media type and serves the REQ-033 payload', async () => {
    // The one relaxed meta-schema constraint (ExampleXORExamples). The document must load rather
    // than reject with SPEC_INVALID, and REQ-033 level 1 then decides the payload.
    const server = await startServer({ specPath: fixture('tolerated-example-xor-examples.yaml') });
    try {
      const res = await request(server.url, '/both');
      expect({ status: res.status, body: res.json, payload: res.header('x-mock-payload') }).toEqual({
        status: 200,
        body: { p: 'content-example' },
        payload: 'example',
      });
    } finally {
      await server.stop();
    }
  });

  it('REQ-004: resolves for a valid 3.0.x document', async () => {
    const server = await create({ specPath: fixture('minimal.yaml'), port: 0 });
    await server.stop();
    expect(server.address).toBeUndefined();
  });
});

describe('REQ-005 — internal $ref is resolved; an unresolvable $ref fails at load time', () => {
  it('REQ-005: resolves #/components/schemas/Pet so the rex example can be served', async () => {
    const server = await startServer({ specPath: PETSTORE });
    try {
      const res = await request(server.url, '/pets/1', { headers: { prefer: 'example=rex' } });
      const expected = await documentedExample(PETSTORE, { path: '/pets/{petId}', name: 'rex' });
      expect(res.json).toEqual(expected);
    } finally {
      await server.stop();
    }
  });

  it('REQ-005: rejects an unresolvable $ref with SPEC_REF_UNRESOLVABLE and a pointer', async () => {
    const error = await createServerRejection({ specPath: fixture('ref-missing.yaml') });
    expect({ code: error.code, pointerStart: String(error.pointer).slice(0, 2) }).toEqual({
      code: 'SPEC_REF_UNRESOLVABLE',
      pointerStart: '#/',
    });
  });

  it('REQ-005: resolves $ref in parameters, request bodies, responses, examples and headers', async () => {
    const path = fixture('ref-everywhere.yaml');
    const server = await startServer({ specPath: path });
    try {
      const res = await request(server.url, '/things', {
        method: 'POST',
        body: JSON.stringify({ name: 'given' }),
        headers: { 'content-type': 'application/json' },
      });
      const expected = await documentedExample(path, {
        path: '/things',
        method: 'post',
        status: '201',
        name: 'only',
      });
      expect({ status: res.status, body: res.json }).toEqual({ status: 201, body: expected });
    } finally {
      await server.stop();
    }
  });
});

describe('REQ-006 — configuration is validated and documented defaults apply', () => {
  it('REQ-006: rejects a configuration with no specPath', async () => {
    const error = await createServerRejection({} as ServerConfig);
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: rejects an empty-string specPath', async () => {
    const error = await createServerRejection({ specPath: '' });
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: rejects a non-integer port', async () => {
    const error = await createServerRejection({ specPath: PETSTORE, port: 1.5 });
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: rejects a port below the range (-1)', async () => {
    const error = await createServerRejection({ specPath: PETSTORE, port: -1 });
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: rejects a port above the range (65536)', async () => {
    const error = await createServerRejection({ specPath: PETSTORE, port: 65536 });
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: rejects a seed that is not a safe integer', async () => {
    const error = await createServerRejection({ specPath: PETSTORE, seed: 1.5 });
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: rejects an unknown logLevel', async () => {
    const error = await createServerRejection({ specPath: PETSTORE, logLevel: 'verbose' as never });
    expect(error.code).toBe('CONFIG_INVALID');
  });

  it('REQ-006: defaults to 127.0.0.1:4010 and seed 1 when port, host, seed and logLevel are omitted', async () => {
    await withDefaultPortLock(async () => {
      const server = await create({ specPath: PETSTORE });
      const reference = await startServer({ specPath: PETSTORE, seed: 1 });
      try {
        const address = await server.start();
        const fromDefaults = await request(address.url, '/pets');
        const fromSeedOne = await request(reference.url, '/pets');
        expect({
          host: address.host,
          port: address.port,
          status: fromDefaults.status,
          sameBodyAsSeedOne: fromDefaults.text === fromSeedOne.text,
        }).toEqual({ host: '127.0.0.1', port: 4010, status: 200, sameBodyAsSeedOne: true });
      } finally {
        await server.stop();
        await reference.stop();
      }
    });
  });

  it('REQ-006: port 0 resolves start() with a non-zero port that accepts connections', async () => {
    const server = await startServer({ specPath: PETSTORE, port: 0 });
    try {
      expect({ nonZero: server.address.port !== 0, accepts: await portAccepts(server.address.port) }).toEqual({
        nonZero: true,
        accepts: true,
      });
    } finally {
      await server.stop();
    }
  });
});

describe('REQ-007 — fail fast: a specification problem never binds a port', () => {
  it('REQ-007: leaves the configured port refusing connections after createServer rejects', async () => {
    const port = await freePort();
    await createServerRejection({ specPath: fixture('unsupported-cookie-parameter.yaml'), port });
    expect(await portAccepts(port)).toBe(false);
  });

  it('REQ-007: a later server with a valid specification starts on the very same port', async () => {
    const port = await freePort();
    await createServerRejection({ specPath: fixture('invalid-no-responses.yaml'), port });
    const server = await create({ specPath: PETSTORE, port });
    try {
      const address = await server.start();
      expect(address.port).toBe(port);
    } finally {
      await server.stop();
    }
  });

  it('REQ-007: every load-time failure category is raised by createServer, never by start()', async () => {
    const codes: unknown[] = [];
    for (const file of [
      'does-not-exist.yaml',
      'invalid-no-responses.yaml',
      'ref-missing.yaml',
      'unsupported-cookie-parameter.yaml',
    ]) {
      codes.push((await createServerRejection({ specPath: fixture(file) })).code);
    }
    expect(codes).toEqual([
      'SPEC_NOT_FOUND',
      'SPEC_INVALID',
      'SPEC_REF_UNRESOLVABLE',
      'UNSUPPORTED_CONSTRUCT',
    ]);
  });
});

describe('REQ-008 — load-time errors are actionable', () => {
  it('REQ-008: every load-time rejection carries a known code and a non-empty message', async () => {
    const observed: { code: unknown; hasMessage: boolean }[] = [];
    for (const config of [
      { specPath: fixture('does-not-exist.yaml') },
      { specPath: makeDirectory('another-directory') },
      { specPath: fixture('invalid-no-responses.yaml') },
      { specPath: fixture('ref-missing.yaml') },
      { specPath: fixture('unsupported-cookie-parameter.yaml') },
    ]) {
      const error = await createServerRejection(config);
      observed.push({
        code: error.code,
        hasMessage: typeof error.message === 'string' && error.message.length > 0,
      });
    }
    expect(observed.every((o) => LOAD_TIME_CODES.includes(String(o.code)) && o.hasMessage)).toBe(true);
  });

  it.each([
    ['SPEC_INVALID', 'invalid-no-responses.yaml'],
    ['SPEC_REF_UNRESOLVABLE', 'ref-missing.yaml'],
    ['UNSUPPORTED_CONSTRUCT', 'unsupported-cookie-parameter.yaml'],
  ])('REQ-008: %s carries a pointer beginning with #/', async (code, file) => {
    const error = await createServerRejection({ specPath: fixture(file) });
    expect({ code: error.code, pointerStart: String(error.pointer).slice(0, 2) }).toEqual({
      code,
      pointerStart: '#/',
    });
  });

  it('REQ-008: SPEC_NOT_FOUND is actionable without a pointer', async () => {
    const error = await createServerRejection({ specPath: example('no-such-file.yaml') });
    expect({
      code: error.code,
      hasMessage: typeof error.message === 'string' && error.message.length > 0,
    }).toEqual({ code: 'SPEC_NOT_FOUND', hasMessage: true });
  });
});
