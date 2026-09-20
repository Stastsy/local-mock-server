#!/usr/bin/env node
/**
 * Command line entry point (REQ-047 .. REQ-051).
 *
 * A thin wrapper over the public contract whose observable surface is exactly three things:
 * stdout, stderr and the process exit code. Argument parsing uses `node:util`'s built-in
 * `parseArgs` — no dependency needed.
 */

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createServer, type MockServer } from './server.js';
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SEED,
  LOG_LEVELS,
  type LogLevel,
  type MockServerConfig,
} from './config.js';
import { MockError } from './errors.js';

const USAGE = `local-mock-server — serve dynamic HTTP responses from an OpenAPI 3.0 specification

Usage:
  mock-server --spec <path> [options]

Options:
  -s, --spec <path>      Path to a local OpenAPI 3.0.x document (YAML or JSON). Required.
  -p, --port <number>    Port to bind (default: ${DEFAULT_PORT}; 0 picks a free port).
      --host <address>   Interface to bind (default: ${DEFAULT_HOST}).
      --seed <number>    Seed for generated data; equal seeds give equal responses (default: ${DEFAULT_SEED}).
      --log-level <lvl>  ${LOG_LEVELS.join(' | ')} (default: info).
  -h, --help             Show this help.

Response selection:
  Prefer: code=404              Return the 404 response defined for the operation.
  Prefer: example=notFound      Return the named example instead of generated data.
`;

/** Exit codes REQ-047 .. REQ-051 prescribe. */
const OK = 0;
const LOAD_FAILURE = 1;
const USAGE_ERROR = 2;

/** Thrown for anything that must exit 2 with the usage text. */
class UsageError extends Error {
  readonly showUsage: boolean;
  constructor(message: string, showUsage = true) {
    super(message);
    this.name = 'UsageError';
    this.showUsage = showUsage;
  }
}

interface CliOptions {
  spec: string;
  port?: number;
  host?: string;
  seed?: number;
  logLevel: LogLevel;
}

function parseInteger(option: string, raw: string): number {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(value)) {
    throw new UsageError(`Option --${option} expects an integer, received "${raw}".`, false);
  }
  return value;
}

function parseOptions(argv: string[]): CliOptions | undefined {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        spec: { type: 'string', short: 's' },
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        seed: { type: 'string' },
        'log-level': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error: unknown) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  // REQ-047: `--help`, `-h` and an empty argument list all print the usage and exit 0.
  if (values['help'] === true || argv.length === 0) return undefined;

  const spec = values['spec'];
  if (typeof spec !== 'string' || spec === '') {
    throw new UsageError('Option --spec is required and must name a specification file.');
  }

  const options: CliOptions = { spec, logLevel: 'info' };

  const port = values['port'];
  if (typeof port === 'string') options.port = parseInteger('port', port);

  const host = values['host'];
  if (typeof host === 'string') options.host = host;

  const seed = values['seed'];
  if (typeof seed === 'string') options.seed = parseInteger('seed', seed);

  const logLevel = values['log-level'];
  if (typeof logLevel === 'string') {
    if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
      throw new UsageError(
        `Option --log-level expects one of ${LOG_LEVELS.join(', ')}, received "${logLevel}".`,
        false,
      );
    }
    options.logLevel = logLevel as LogLevel;
  }

  return options;
}

function toConfig(options: CliOptions): MockServerConfig {
  const config: MockServerConfig = { specPath: options.spec, logLevel: options.logLevel };
  if (options.port !== undefined) config.port = options.port;
  if (options.host !== undefined) config.host = options.host;
  if (options.seed !== undefined) config.seed = options.seed;
  return config;
}

function installSignalHandlers(server: MockServer): void {
  const shutdown = (): void => {
    void server.stop().then(
      () => process.exit(OK),
      () => process.exit(OK),
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/** Resolves with the exit code; leaves the process running once a server has started. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let options: CliOptions | undefined;
  try {
    options = parseOptions(argv);
  } catch (error: unknown) {
    const usageError = error as UsageError;
    process.stderr.write(`Error: ${usageError.message}\n`);
    if (usageError.showUsage !== false) process.stderr.write(`\n${USAGE}`);
    return USAGE_ERROR;
  }

  if (options === undefined) {
    process.stdout.write(USAGE);
    return OK;
  }

  let server: MockServer;
  try {
    server = await createServer(toConfig(options));
  } catch (error: unknown) {
    // REQ-051: a load failure names its stable code first, on stderr, and exits 1.
    if (error instanceof MockError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      if (error.pointer !== undefined) process.stderr.write(`  at ${error.pointer}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    return LOAD_FAILURE;
  }

  const address = await server.start();
  installSignalHandlers(server);
  process.stdout.write(`Mock server listening on ${address.url}\n`);
  return OK;
}

const entry = process.argv[1];
const isDirectRun = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (isDirectRun) {
  main().then(
    (code) => {
      if (code !== OK) process.exit(code);
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(LOAD_FAILURE);
    },
  );
}
