#!/usr/bin/env node
/**
 * Command line entry point.
 *
 * Argument parsing uses `node:util`'s built-in `parseArgs` — no dependency needed.
 */

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createServer } from './server.js';
import { DEFAULT_HOST, DEFAULT_PORT, DEFAULT_SEED, type MockServerConfig } from './config.js';
import { MockError } from './errors.js';

const USAGE = `local-mock-server — serve dynamic HTTP responses from an OpenAPI 3.0 specification

Usage:
  mock-server --spec <path> [options]

Options:
  -s, --spec <path>      Path to a local OpenAPI 3.0.x document (YAML or JSON). Required.
  -p, --port <number>    Port to bind (default: ${DEFAULT_PORT}; 0 picks a free port).
      --host <address>   Interface to bind (default: ${DEFAULT_HOST}).
      --seed <number>    Seed for generated data; equal seeds give equal responses (default: ${DEFAULT_SEED}).
      --log-level <lvl>  silent | error | warn | info | debug (default: info).
  -h, --help             Show this help.

Response selection:
  Prefer: code=404              Return the 404 response defined for the operation.
  Prefer: example=notFound      Return the named example instead of generated data.
`;

function parseIntegerOption(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new MockError('SPEC_INVALID', `Option --${name} expects an integer, received "${raw}".`);
  }
  return value;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
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
  });

  if (values.help === true || argv.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  if (values.spec === undefined || values.spec === '') {
    process.stderr.write('Error: --spec is required.\n\n' + USAGE);
    process.exitCode = 2;
    return;
  }

  const config: MockServerConfig = { specPath: values.spec };
  if (values.port !== undefined) config.port = parseIntegerOption('port', values.port);
  if (values.host !== undefined) config.host = values.host;
  if (values.seed !== undefined) config.seed = parseIntegerOption('seed', values.seed);
  config.logLevel =
    values['log-level'] === undefined
      ? 'info'
      : (values['log-level'] as NonNullable<MockServerConfig['logLevel']>);

  const server = await createServer(config);
  const address = await server.start();
  process.stdout.write(`Mock server listening on ${address.url}\n`);

  const shutdown = (): void => {
    void server.stop().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const entry = process.argv[1];
const isDirectRun = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (isDirectRun) {
  main().catch((error: unknown) => {
    if (error instanceof MockError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      if (error.pointer !== undefined) process.stderr.write(`  at ${error.pointer}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exitCode = 1;
  });
}
