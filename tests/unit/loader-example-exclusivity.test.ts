/**
 * REQ-004 tolerates `ExampleXORExamples` on the Media Type Object and on nothing else. The
 * acceptance suite draws that boundary for the Parameter Object; these cases cover the parts that
 * are invisible over HTTP — a Header Object, which the server never emits (REQ-043), and the fact
 * that the relaxation lives in the throwaway copy handed to the validator, so the document the
 * server reads still carries both members for REQ-033 to rank.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MockError } from '../../src/errors.js';
import { loadSpec } from '../../src/spec/loader.js';
import { isRecord } from '../../src/spec/types.js';

let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'mock-server-xor-'));
});

async function specFile(name: string, document: unknown): Promise<string> {
  const path = join(directory, `${name}.json`);
  await writeFile(path, JSON.stringify(document), 'utf8');
  return path;
}

const BOTH = {
  example: { p: 'from-example' },
  examples: { named: { value: { p: 'from-examples' } } },
} as const;

const JSON_CONTENT = {
  'application/json': {
    schema: { type: 'object', properties: { p: { type: 'string' } } },
    ...BOTH,
  },
};

function documentWith(response: Record<string, unknown>): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Example exclusivity', version: '1.0.0' },
    paths: { '/both': { get: { operationId: 'getBoth', responses: { '200': response } } } },
  };
}

async function loadRejection(path: string): Promise<MockError> {
  try {
    await loadSpec(path);
  } catch (error: unknown) {
    if (error instanceof MockError) return error;
    throw error;
  }
  throw new Error(`Expected "${path}" to be rejected.`);
}

describe('relaxing ExampleXORExamples', () => {
  it('leaves both members on the media type object the server serves from', async () => {
    const path = await specFile('media-type-both', documentWith({ description: 'ok', content: JSON_CONTENT }));

    const { document } = await loadSpec(path);

    const operation = document.paths?.['/both']?.['get'];
    const responses = isRecord(operation) ? operation['responses'] : undefined;
    expect(responses).toMatchObject({ '200': { content: { 'application/json': BOTH } } });
  });

  it('rejects a header object declaring both, which the tolerance does not cover', async () => {
    const path = await specFile(
      'header-both',
      documentWith({
        description: 'ok',
        headers: { 'X-Trace': { schema: { type: 'string' }, example: 'a', examples: { one: { value: 'a' } } } },
        content: JSON_CONTENT,
      }),
    );

    expect((await loadRejection(path)).code).toBe('SPEC_INVALID');
  });

  it('does not mistake a schema property named content for a content map', async () => {
    // `properties.content` is a Schema Object, not a map of media types: the walk must keep
    // descending without treating its members as media type objects.
    const path = await specFile(
      'schema-property-named-content',
      documentWith({
        description: 'ok',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { content: { type: 'object', properties: { p: { type: 'string' } } } },
            },
          },
        },
      }),
    );

    await expect(loadSpec(path)).resolves.toBeDefined();
  });
});
