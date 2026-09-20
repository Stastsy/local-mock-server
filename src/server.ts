/**
 * Public contract of the mock server.
 *
 * These three entry points — `createServer`, `start`, `stop` — are the ONLY
 * surface the acceptance test suite is allowed to depend on. Everything else
 * (HTTP framework, routing, validation, data generation) is an implementation
 * detail and may be replaced without touching a single acceptance test.
 *
 * BOOTSTRAP SKELETON: the pipeline is not implemented yet. The server binds a
 * port and answers every request with 501 NOT_IMPLEMENTED, so that acceptance
 * tests written before the implementation fail on their assertions rather than
 * on a connection error.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { resolveConfig, type MockServerConfig } from './config.js';
import { MockError, MOCK_ERROR_MEDIA_TYPE } from './errors.js';

export interface ServerAddress {
  /** Base URL the server is reachable at, e.g. `http://127.0.0.1:4010`. */
  url: string;
  host: string;
  port: number;
}

export interface MockServer {
  /** Binds the port. Resolves with the address actually bound (relevant when port is 0). */
  start(): Promise<ServerAddress>;
  /** Closes the server. Safe to call when not started. */
  stop(): Promise<void>;
  /** Address the server is bound to, or `undefined` while it is not listening. */
  readonly address: ServerAddress | undefined;
}

/**
 * Loads and prepares a mock server for the given specification.
 *
 * Fails fast: an unreadable, invalid or unsupported specification rejects here,
 * before any port is bound, with a {@link MockError} carrying a stable code.
 */
export async function createServer(config: MockServerConfig): Promise<MockServer> {
  const resolved = resolveConfig(config);

  const app: FastifyInstance = Fastify({ logger: resolved.logLevel === 'silent' ? false : { level: resolved.logLevel } });

  app.setNotFoundHandler((request, reply) => {
    const error = new MockError(
      'NOT_IMPLEMENTED',
      `Mock server is not implemented yet: cannot answer ${request.method} ${request.url}.`,
      { status: 501 },
    );
    void reply.code(error.status).type(MOCK_ERROR_MEDIA_TYPE).send(error.toBody());
  });

  app.setErrorHandler((error, _request, reply) => {
    const mockError =
      error instanceof MockError
        ? error
        : new MockError('GENERATION_FAILED', error instanceof Error ? error.message : String(error), { status: 500, cause: error });
    void reply.code(mockError.status).type(MOCK_ERROR_MEDIA_TYPE).send(mockError.toBody());
  });

  let address: ServerAddress | undefined;

  return {
    get address() {
      return address;
    },
    async start(): Promise<ServerAddress> {
      await app.listen({ port: resolved.port, host: resolved.host });
      const bound = app.server.address();
      if (bound === null || typeof bound === 'string') {
        throw new MockError('GENERATION_FAILED', 'Server did not report a TCP address after listening.');
      }
      address = { url: `http://${resolved.host}:${bound.port}`, host: resolved.host, port: bound.port };
      return address;
    },
    async stop(): Promise<void> {
      await app.close();
      address = undefined;
    },
  };
}
