/** TCP helpers: free-port allocation, reachability probes, and a cross-process lock. */

import { createServer as createTcpServer, connect, type AddressInfo } from 'node:net';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Reserves a port by binding and releasing it, so a test can use it as a known free port. */
export async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createTcpServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo;
      probe.close(() => resolve(address.port));
    });
  });
}

/** True when a TCP connection to the port is accepted within the timeout. */
export async function portAccepts(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ port, host });
    const settle = (accepted: boolean): void => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.once('timeout', () => settle(false));
  });
}

/**
 * A cross-process mutex. Several spec files legitimately need the default port 4010 (REQ-006's
 * defaults, the CLI's "no port is bound" checks); vitest runs spec files in parallel, so they take
 * this lock rather than racing for the socket.
 */
const LOCK = join(tmpdir(), 'local-mock-server-qa-default-port.lock');

export async function withDefaultPortLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      if (Date.now() > deadline) {
        // Stale lock from a killed worker: take it over rather than failing an unrelated test.
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}
