/**
 * Throwaway specification documents.
 *
 * Used only for mechanical variants of one concern — the `openapi` version matrix, an unparseable
 * file, a directory as `specPath` — where a checked-in fixture per case would be a dozen files
 * differing in one line. Behavioural fixtures live in `qa/fixtures/` as real documents.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lms-qa-'));
  roots.push(dir);
  return dir;
}

/** Writes raw text to a file with the given name and returns its absolute path. */
export function writeSpecText(fileName: string, contents: string): string {
  const path = join(root(), fileName);
  writeFileSync(path, contents, 'utf8');
  return path;
}

/** Writes an object as JSON and returns its absolute path. */
export function writeSpecJson(fileName: string, document: unknown): string {
  return writeSpecText(fileName, JSON.stringify(document, null, 2));
}

/** Creates an empty directory and returns its absolute path, for the "specPath is a directory" case. */
export function makeDirectory(name = 'a-directory'): string {
  const path = join(root(), name);
  mkdirSync(path);
  return path;
}

/** Removes every temporary directory this module created. Call from `afterAll`. */
export function cleanupSpecFiles(): void {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The smallest valid document body, parameterised by its root keys. `overrides` are merged at the
 * top level so a test can swap `openapi` for `swagger`, or drop the version key entirely.
 */
export function minimalDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Generated', version: '1.0.0' },
    paths: {
      '/ping': {
        get: {
          operationId: 'ping',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
                },
              },
            },
          },
        },
      },
    },
    ...overrides,
  };
}
