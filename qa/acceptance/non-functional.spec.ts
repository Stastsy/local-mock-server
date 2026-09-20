/**
 * REQ-052 .. REQ-058 — determinism, seed scope, statelessness, lifecycle, silence, startup cost.
 *
 * Determinism and seed scope are observed through `X-Mock-Seed` / `X-Mock-Payload` (REQ-044) and by
 * comparing two responses to each other. No test hard-codes a generated value.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PETSTORE, create, fixture, repoRoot, startServer, useServer } from '../helpers/server.js';
import { request } from '../helpers/http.js';
import { requestInSubprocess } from '../helpers/subprocess-request.js';
import { freePort, portAccepts } from '../helpers/net.js';

describe('REQ-052 — determinism', () => {
  // The criteria that assert on X-Mock-Seed are stated against a generating operation, because
  // only a generated payload carries that header (REQ-044). `GET /pets` on the petstore is one;
  // `GET /pets/1` deliberately is not, and backs the example-payload criterion below.
  const server = useServer({ specPath: PETSTORE, seed: 42 });
  const generating = useServer({ specPath: fixture('generating-operations.yaml'), seed: 42 });

  it('REQ-052: the same request issued twice returns byte-identical bodies', async () => {
    const first = await request(server().url, '/pets?limit=3');
    const second = await request(server().url, '/pets?limit=3');
    expect({ status: first.status, sameBody: first.text === second.text }).toEqual({
      status: 200,
      sameBody: true,
    });
  });

  it('REQ-052: a repeated request to a generating operation repeats its seed and its body', async () => {
    const first = await request(generating().url, '/things/1');
    const second = await request(generating().url, '/things/1');
    expect({
      payloads: [first.header('x-mock-payload'), second.header('x-mock-payload')],
      sameSeed: first.header('x-mock-seed') === second.header('x-mock-seed'),
      seedPresent: first.header('x-mock-seed') !== undefined,
      sameBody: first.text === second.text,
    }).toEqual({
      payloads: ['generated', 'generated'],
      sameSeed: true,
      seedPresent: true,
      sameBody: true,
    });
  });

  it('REQ-052: two servers in the same process with the same seed agree', async () => {
    const other = await startServer({ specPath: PETSTORE, seed: 42 });
    try {
      const here = await request(server().url, '/pets?limit=3');
      const there = await request(other.url, '/pets?limit=3');
      expect({ status: here.status, same: here.text === there.text }).toEqual({
        status: 200,
        same: true,
      });
    } finally {
      await other.stop();
    }
  });

  it('REQ-052: two servers in separate processes with the same seed agree', async () => {
    const here = await request(server().url, '/pets?limit=3');
    const there = await requestInSubprocess(PETSTORE, 42, '/pets?limit=3');
    expect({ status: there.status, same: here.text === there.body }).toEqual({
      status: 200,
      same: true,
    });
  });

  it('REQ-052: different seeds produce different effective seeds for a generating operation', async () => {
    const other = await startServer({ specPath: fixture('generating-operations.yaml'), seed: 43 });
    try {
      const here = await request(generating().url, '/things/1');
      const there = await request(other.url, '/things/1');
      expect({
        payloads: [here.header('x-mock-payload'), there.header('x-mock-payload')],
        differ: here.header('x-mock-seed') !== there.header('x-mock-seed'),
      }).toEqual({ payloads: ['generated', 'generated'], differ: true });
    } finally {
      await other.stop();
    }
  });

  it('REQ-052: the seed cannot influence a payload the specification prescribes', async () => {
    const other = await startServer({ specPath: PETSTORE, seed: 43 });
    try {
      const here = await request(server().url, '/pets/1');
      const there = await request(other.url, '/pets/1');
      expect({
        payloads: [here.header('x-mock-payload'), there.header('x-mock-payload')],
        same: here.text === there.text,
      }).toEqual({ payloads: ['example', 'example'], same: true });
    } finally {
      await other.stop();
    }
  });

  it('REQ-052: interleaved requests to other operations carry no generator state over', async () => {
    const first = await request(server().url, '/pets?limit=3');
    await request(server().url, '/pets/1');
    await request(server().url, '/pets?limit=4');
    await request(server().url, '/pets/2');
    const second = await request(server().url, '/pets?limit=3');
    expect({ status: first.status, same: first.text === second.text }).toEqual({
      status: 200,
      same: true,
    });
  });
});
describe('REQ-053 — concurrent and repeated instances do not interfere', () => {
  it('REQ-053: two simultaneous servers with different seeds each answer as if alone', async () => {
    const a = await startServer({ specPath: PETSTORE, seed: 42 });
    const b = await startServer({ specPath: PETSTORE, seed: 43 });
    const alone = await startServer({ specPath: PETSTORE, seed: 42 });
    try {
      const interleaved: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        interleaved.push((await request(a.url, '/pets?limit=3')).text);
        interleaved.push((await request(b.url, '/pets?limit=3')).text);
      }
      const reference = await request(alone.url, '/pets?limit=3');
      expect({
        payload: reference.header('x-mock-payload'),
        matches: interleaved.filter((_, index) => index % 2 === 0).every((body) => body === reference.text),
      }).toEqual({ payload: 'generated', matches: true });
    } finally {
      await a.stop();
      await b.stop();
      await alone.stop();
    }
  });

  it('REQ-053: ten concurrent identical requests return byte-identical bodies', async () => {
    const server = await startServer({ specPath: PETSTORE, seed: 42 });
    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => request(server.url, '/pets?limit=3')),
      );
      expect({
        payloads: [...new Set(responses.map((res) => res.header('x-mock-payload')))],
        distinctBodies: new Set(responses.map((res) => res.text)).size,
      }).toEqual({ payloads: ['generated'], distinctBodies: 1 });
    } finally {
      await server.stop();
    }
  });
});

describe('REQ-054 — the effective seed is derived from the seed and the request identity', () => {
  // G1 — a generating operation at a templated path. REQ-054 names no existing file for this
  // shape and asks QA to supply one.
  const g1 = useServer({ specPath: fixture('generating-operations.yaml'), seed: 7 });
  // G2 — `GET /pets` on the petstore, which REQ-054 names as its G2 generating operation.
  const g2 = useServer({ specPath: PETSTORE, seed: 7 });

  it('REQ-054: two different paths of a generating operation are independent draws', async () => {
    const one = await request(g1().url, '/things/1');
    const two = await request(g1().url, '/things/2');
    expect({
      payloads: [one.header('x-mock-payload'), two.header('x-mock-payload')],
      seedsDiffer: one.header('x-mock-seed') !== two.header('x-mock-seed'),
    }).toEqual({ payloads: ['generated', 'generated'], seedsDiffer: true });
  });

  it('REQ-054: the same templated path requested twice repeats its seed and its body', async () => {
    const one = await request(g1().url, '/things/1');
    const two = await request(g1().url, '/things/1');
    expect({
      present: one.header('x-mock-seed') !== undefined,
      sameSeed: one.header('x-mock-seed') === two.header('x-mock-seed'),
      sameBody: one.text === two.text,
    }).toEqual({ present: true, sameSeed: true, sameBody: true });
  });

  it('REQ-054: two different query strings are independent draws', async () => {
    const one = await request(g2().url, '/pets?limit=1');
    const two = await request(g2().url, '/pets?limit=2');
    expect({
      payloads: [one.header('x-mock-payload'), two.header('x-mock-payload')],
      seedsDiffer: one.header('x-mock-seed') !== two.header('x-mock-seed'),
    }).toEqual({ payloads: ['generated', 'generated'], seedsDiffer: true });
  });

  it('REQ-054: query parameter order is not part of the request identity', async () => {
    const one = await request(g2().url, '/pets?limit=1&status=sold');
    const two = await request(g2().url, '/pets?status=sold&limit=1');
    expect({
      present: one.header('x-mock-seed') !== undefined,
      sameSeed: one.header('x-mock-seed') === two.header('x-mock-seed'),
      sameBody: one.text === two.text,
    }).toEqual({ present: true, sameSeed: true, sameBody: true });
  });

  it('REQ-054: Prefer influences identity only through the status and media type it selects', async () => {
    const withPrefer = await request(g2().url, '/pets', { headers: { prefer: 'code=200' } });
    const without = await request(g2().url, '/pets');
    expect({
      payload: without.header('x-mock-payload'),
      sameSeed: withPrefer.header('x-mock-seed') === without.header('x-mock-seed'),
      sameBody: withPrefer.text === without.text,
    }).toEqual({ payload: 'generated', sameSeed: true, sameBody: true });
  });

  it('REQ-054: the same request twice yields the same effective seed', async () => {
    const one = await request(g2().url, '/pets');
    const two = await request(g2().url, '/pets');
    expect({
      present: one.header('x-mock-seed') !== undefined,
      same: one.header('x-mock-seed') === two.header('x-mock-seed'),
    }).toEqual({ present: true, same: true });
  });
});
describe('REQ-055 — statelessness', () => {
  const server = useServer({ specPath: PETSTORE, seed: 11 });

  it('REQ-055: a POST does not change what a later GET returns', async () => {
    await request(server().url, '/pets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rex' }),
      headers: { 'content-type': 'application/json' },
    });
    const afterPost = await request(server().url, '/pets?limit=3');

    const fresh = await startServer({ specPath: PETSTORE, seed: 11 });
    try {
      const onFreshServer = await request(fresh.url, '/pets?limit=3');
      expect({ payload: afterPost.header('x-mock-payload'), same: afterPost.text === onFreshServer.text }).toEqual(
        { payload: 'generated', same: true },
      );
    } finally {
      await fresh.stop();
    }
  });

  it('REQ-055: two different POSTs leave the following GETs identical', async () => {
    await request(server().url, '/pets', {
      method: 'POST',
      body: JSON.stringify({ name: 'One' }),
      headers: { 'content-type': 'application/json' },
    });
    const first = await request(server().url, '/pets?limit=2');
    await request(server().url, '/pets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Two' }),
      headers: { 'content-type': 'application/json' },
    });
    const second = await request(server().url, '/pets?limit=2');
    expect({ payload: first.header('x-mock-payload'), same: first.text === second.text }).toEqual({
      payload: 'generated',
      same: true,
    });
  });

  it('REQ-055: a single-resource GET never reflects an earlier write', async () => {
    // Generated, not an example: on examples/petstore.yaml this operation always serves the `rex`
    // example, which would make the assertion trivially true.
    const generated = await startServer({ specPath: fixture('generating-operations.yaml'), seed: 11 });
    try {
      const before = await request(generated.url, '/things/9');
      await request(generated.url, '/things', {
        method: 'POST',
        body: JSON.stringify({ name: 'Nine' }),
        headers: { 'content-type': 'application/json' },
      });
      const after = await request(generated.url, '/things/9');
      expect({ payload: before.header('x-mock-payload'), same: before.text === after.text }).toEqual({
        payload: 'generated',
        same: true,
      });
    } finally {
      await generated.stop();
    }
  });

  it('REQ-055: no file in the project tree is created or modified while the server runs', async () => {
    const before = snapshot(repoRoot());
    await request(server().url, '/pets');
    const created = await request(server().url, '/pets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Rex' }),
      headers: { 'content-type': 'application/json' },
    });
    expect({ status: created.status, tree: snapshot(repoRoot()) }).toEqual({ status: 201, tree: before });
  });
});

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

/** Path -> mtime for the project tree, used to prove the server writes nothing. */
function snapshot(root: string, prefix = ''): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(root, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      Object.assign(result, snapshot(full, `${key}/`));
    } else {
      result[key] = statSync(full).mtimeMs;
    }
  }
  return result;
}

describe('REQ-056 — lifecycle contract', () => {
  it('REQ-056: address is undefined before start()', async () => {
    const server = await create({ specPath: PETSTORE, port: 0 });
    try {
      expect(server.address).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it('REQ-056: start() resolves with the address actually bound, and address returns the same', async () => {
    const server = await create({ specPath: PETSTORE, port: 0, host: '127.0.0.1' });
    try {
      const address = await server.start();
      expect({
        url: address.url,
        host: address.host,
        portIsNumber: Number.isInteger(address.port) && address.port > 0,
        sameAsProperty: JSON.stringify(server.address) === JSON.stringify(address),
      }).toEqual({
        url: `http://127.0.0.1:${address.port}`,
        host: '127.0.0.1',
        portIsNumber: true,
        sameAsProperty: true,
      });
    } finally {
      await server.stop();
    }
  });

  it('REQ-056: after stop() the port refuses connections and address is undefined', async () => {
    const server = await create({ specPath: PETSTORE, port: 0 });
    const address = await server.start();
    await server.stop();
    expect({ accepts: await portAccepts(address.port), address: server.address }).toEqual({
      accepts: false,
      address: undefined,
    });
  });

  it('REQ-056: stop() on a server that was never started resolves', async () => {
    const server = await create({ specPath: PETSTORE, port: 0 });
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('REQ-056: stop() called twice resolves both times', async () => {
    const server = await create({ specPath: PETSTORE, port: 0 });
    await server.start();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('REQ-056: start() rejects when the configured port is already in use', async () => {
    const holder = await startServer({ specPath: PETSTORE, port: await freePort() });
    const second = await create({ specPath: PETSTORE, port: holder.address.port });
    try {
      await expect(second.start()).rejects.toBeDefined();
    } finally {
      await second.stop().catch(() => undefined);
      await holder.stop();
    }
  });
});

describe('REQ-057 — silence by default', () => {
  afterEach(() => vi.restoreAllMocks());

  it('REQ-057: nothing is written to stdout or stderr with no logLevel configured', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const server = await create({ specPath: PETSTORE, port: 0 });
    const address = await server.start();
    await request(address.url, '/pets');
    await request(address.url, '/no-such-path');
    await server.stop();

    const written = [...out.mock.calls, ...err.mock.calls].map((call) => String(call[0])).join('');
    out.mockRestore();
    err.mockRestore();
    expect(written).toBe('');
  });
});

describe('REQ-058 — startup cost', () => {
  it('REQ-058: createServer followed by start() resolves within 5 seconds', async () => {
    const began = Date.now();
    const server = await create({ specPath: PETSTORE, port: 0 });
    await server.start();
    const elapsed = Date.now() - began;
    await server.stop();
    expect(elapsed).toBeLessThan(5000);
  });
});
