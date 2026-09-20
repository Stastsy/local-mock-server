import { MockError } from './errors.js';

/** Resolved runtime configuration of a mock server instance. */
export interface MockServerConfig {
  /** Path to a local OpenAPI 3.0.x document (YAML or JSON). */
  specPath: string;
  /** TCP port to bind. `0` selects a free ephemeral port — used by the test suites. */
  port?: number;
  /** Interface to bind. Defaults to `127.0.0.1`. */
  host?: string;
  /** Seed for the response data generator. Equal seeds produce equal responses. */
  seed?: number;
  /** Fastify log level. Defaults to `silent` so test output stays readable. */
  logLevel?: LogLevel;
}

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface ResolvedConfig {
  specPath: string;
  port: number;
  host: string;
  seed: number;
  logLevel: LogLevel;
}

export const DEFAULT_PORT = 4010;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_SEED = 1;
export const DEFAULT_LOG_LEVEL: LogLevel = 'silent';

export const LOG_LEVELS: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug'];

function invalid(message: string): never {
  throw new MockError('CONFIG_INVALID', message);
}

/**
 * REQ-006: validate before touching the file system, so a configuration mistake is never reported
 * as a specification problem.
 */
export function resolveConfig(config: MockServerConfig): ResolvedConfig {
  if (config === null || typeof config !== 'object') {
    invalid('Configuration must be an object with at least a "specPath" member.');
  }

  const { specPath, port, host, seed, logLevel } = config;

  if (typeof specPath !== 'string' || specPath.length === 0) {
    invalid('Configuration member "specPath" must be a non-empty string.');
  }

  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    invalid(`Configuration member "port" must be an integer in 0..65535, received ${String(port)}.`);
  }

  if (seed !== undefined && !Number.isSafeInteger(seed)) {
    invalid(`Configuration member "seed" must be a safe integer, received ${String(seed)}.`);
  }

  if (host !== undefined && (typeof host !== 'string' || host.length === 0)) {
    invalid('Configuration member "host" must be a non-empty string.');
  }

  if (logLevel !== undefined && !LOG_LEVELS.includes(logLevel)) {
    invalid(
      `Configuration member "logLevel" must be one of ${LOG_LEVELS.join(', ')}, received ${String(logLevel)}.`,
    );
  }

  return {
    specPath,
    port: port ?? DEFAULT_PORT,
    host: host ?? DEFAULT_HOST,
    seed: seed ?? DEFAULT_SEED,
    logLevel: logLevel ?? DEFAULT_LOG_LEVEL,
  };
}
