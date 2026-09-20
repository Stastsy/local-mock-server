/**
 * CLI harness. The CLI's observable surface is stdout, stderr and the exit code (REQ-047..REQ-051),
 * so every test drives it as a real child process.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { repoRoot } from './server.js';

/**
 * The tsx CLI is invoked through `node` rather than through `npx`: current Node releases refuse to
 * spawn a `.cmd` shim without a shell, and a shell would swallow the child's exit code.
 */
const TSX_CLI = join(repoRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

export interface CliResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** True when the process had to be killed because it never exited on its own. */
  timedOut?: boolean;
}

function spawnCli(args: string[]): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [TSX_CLI, 'src/cli.ts', ...args], {
    cwd: repoRoot(),
    env: { ...process.env, NO_COLOR: '1' },
    shell: false,
  });
}

/**
 * Runs the CLI to completion and captures its streams.
 *
 * A process that never exits is killed and reported as `timedOut`, never as a thrown error: a
 * CLI that should have exited but kept running is a finding about the CLI, and the calling test
 * must be the one that fails, on its own assertion.
 */
export async function runCli(args: string[], timeoutMs = 8000): Promise<CliResult> {
  const child = spawnCli(args);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

  return new Promise<CliResult>((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

export interface RunningCli {
  child: ChildProcessWithoutNullStreams;
  stdout(): string;
  stderr(): string;
  /** Resolves with the exit code once the process terminates. */
  exited: Promise<CliResult>;
  kill(signal: NodeJS.Signals): void;
}

/** Starts the CLI and leaves it running, resolving once `predicate` sees the accumulated stdout. */
export async function startCli(
  args: string[],
  predicate: (stdout: string) => boolean = (out) => /http:\/\/[^\s]+/.test(out),
  timeoutMs = 12_000,
): Promise<RunningCli> {
  const child = spawnCli(args);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));

  const exited = new Promise<CliResult>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

  const deadline = Date.now() + timeoutMs;
  while (!predicate(stdout)) {
    if (child.exitCode !== null) break;
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`CLI produced no startup line within ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    exited,
    kill: (signal) => {
      child.kill(signal);
    },
  };
}

/**
 * Extracts the first `http://host:port` URL from CLI output. Quotes, braces and commas terminate
 * the match so that a URL embedded in a structured log line comes back clean.
 */
export function urlFrom(output: string): string | undefined {
  return /https?:\/\/[^\s"'`,}\\]+/.exec(output)?.[0];
}
