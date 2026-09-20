/**
 * Runs one request against a freshly started server in a **separate process** and prints the
 * result as JSON. REQ-052 requires determinism to hold across processes, which cannot be observed
 * from inside the test process.
 *
 * Not a spec file: vitest collects only `qa/acceptance/**\/*.spec.ts`.
 *
 *   npx tsx qa/helpers/subprocess-request.ts <specPath> <seed> <requestPath> [preferHeader]
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoRoot, startServer } from './server.js';
import { request } from './http.js';

export interface SubprocessResult {
  status: number;
  body: string;
  seed: string | undefined;
  payload: string | undefined;
}

async function main(): Promise<void> {
  const [specPath, seedRaw, requestPath, prefer] = process.argv.slice(2);
  if (specPath === undefined || seedRaw === undefined || requestPath === undefined) {
    throw new Error('usage: subprocess-request.ts <specPath> <seed> <requestPath> [prefer]');
  }

  const started = await startServer({ specPath, seed: Number(seedRaw) });
  try {
    const res = await request(started.url, requestPath, prefer === undefined ? {} : { headers: { prefer } });
    const result: SubprocessResult = {
      status: res.status,
      body: res.text,
      seed: res.header('x-mock-seed'),
      payload: res.header('x-mock-payload'),
    };
    process.stdout.write(`<<<RESULT>>>${JSON.stringify(result)}`);
  } finally {
    await started.stop();
  }
}

/** Spawns this file with `tsx` and returns the parsed result. */
export async function requestInSubprocess(
  specPath: string,
  seed: number,
  requestPath: string,
  prefer?: string,
): Promise<SubprocessResult> {
  const self = fileURLToPath(import.meta.url);
  // `node` + tsx's own entry point: Node refuses to spawn the `npx.cmd` shim without a shell.
  const tsxCli = join(repoRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const args = [tsxCli, self, specPath, String(seed), requestPath];
  if (prefer !== undefined) args.push(prefer);

  const child = spawn(process.execPath, args, {
    cwd: repoRoot(),
    env: { ...process.env, NO_COLOR: '1' },
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });

  const marker = stdout.indexOf('<<<RESULT>>>');
  if (code !== 0 || marker === -1) {
    throw new Error(`Subprocess request failed (exit ${String(code)}). stdout=${stdout} stderr=${stderr}`);
  }
  return JSON.parse(stdout.slice(marker + '<<<RESULT>>>'.length)) as SubprocessResult;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
}
