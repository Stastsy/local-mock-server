/**
 * Server harness for the acceptance suite.
 *
 * `createServer` is the ONLY thing this suite imports from `src/` (ARCHITECTURE section 4, rule 1).
 * The configuration and error shapes below are declared locally on purpose: importing the
 * Developer's types would quietly re-couple the suite to files it is not allowed to depend on.
 */

import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import { createServer } from '../../src/server.js';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/** Structural mirror of the public `MockServerConfig` (ARCHITECTURE section 3). */
export interface ServerConfig {
  specPath: string;
  port?: number;
  host?: string;
  seed?: number;
  logLevel?: LogLevel;
}

export interface ServerAddressLike {
  url: string;
  host: string;
  port: number;
}

export interface MockServerLike {
  start(): Promise<ServerAddressLike>;
  stop(): Promise<void>;
  readonly address: ServerAddressLike | undefined;
}

/** Structural mirror of the public `MockError` shape (ARCHITECTURE section 5). */
export interface MockErrorLike {
  code?: unknown;
  message?: unknown;
  pointer?: unknown;
  details?: unknown;
}

/** Absolute path of a fixture in `qa/fixtures`. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

/** Absolute path inside `examples/`, for the criteria written against the shipped petstore. */
export function example(name: string): string {
  return fileURLToPath(new URL(`../../examples/${name}`, import.meta.url));
}

/** Absolute path of the repository root. */
export function repoRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url));
}

export const PETSTORE = example('petstore.yaml');

export async function create(config: ServerConfig): Promise<MockServerLike> {
  return (await createServer(config as never)) as unknown as MockServerLike;
}

export interface Started {
  url: string;
  address: ServerAddressLike;
  server: MockServerLike;
  stop(): Promise<void>;
}

/** Creates and starts a server on an ephemeral port unless the caller asks for a specific one. */
export async function startServer(config: ServerConfig): Promise<Started> {
  const server = await create({ port: 0, ...config });
  const address = await server.start();
  return {
    url: address.url,
    address,
    server,
    stop: () => server.stop(),
  };
}

/**
 * Registers a server for the surrounding suite and guarantees `stop()` in `afterAll`, including
 * when a test failed or the startup itself failed.
 */
export function useServer(config: ServerConfig): () => Started {
  let started: Started | undefined;

  beforeAll(async () => {
    started = await startServer(config);
  });

  afterAll(async () => {
    const running = started;
    started = undefined;
    if (running !== undefined) await running.stop();
  });

  return () => {
    if (started === undefined) throw new Error('Server is not started; beforeAll did not complete.');
    return started;
  };
}

/**
 * Calls `createServer` and returns the rejection value.
 *
 * When it resolves instead, the server is stopped first — a wrongly-bound port must not leak into
 * later tests — and the test then fails on an assertion, not on a thrown helper error.
 */
export async function createServerRejection(config: ServerConfig): Promise<MockErrorLike> {
  let server: MockServerLike;
  try {
    server = await create(config);
  } catch (error) {
    return error as MockErrorLike;
  }
  await server.stop().catch(() => undefined);
  expect.fail(
    `createServer resolved for specPath "${config.specPath}"; expected it to reject with a MockError.`,
  );
}
