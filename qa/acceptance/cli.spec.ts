/**
 * REQ-047 .. REQ-051 — the command line interface.
 *
 * The CLI's observable surface is stdout, stderr and the exit code, so every test drives it as a
 * real child process. Tests that assert "no port is bound" take the default-port lock, because
 * they probe port 4010 and another spec file legitimately binds it.
 */

import { describe, expect, it } from 'vitest';

import { runCli, startCli, urlFrom } from '../helpers/cli.js';
import { request } from '../helpers/http.js';
import { portAccepts, withDefaultPortLock } from '../helpers/net.js';

const SPEC = 'examples/petstore.yaml';
const OPTIONS = ['--spec', '-s', '--port', '-p', '--host', '--seed', '--log-level', '--help', '-h'];

describe('REQ-047 — usage output', () => {
  it.each<[string, string[]]>([
    ['--help', ['--help']],
    ['-h', ['-h']],
    ['no arguments at all', []],
  ])(
    'REQ-047: %s writes usage to stdout, nothing to stderr, exits 0 and binds no port',
    async (_label, args) => {
      const result = await withDefaultPortLock(async () => {
        const run = await runCli(args);
        return { ...run, bound: await portAccepts(4010) };
      });
      expect({
        code: result.code,
        stdoutHasUsage: /usage/i.test(result.stdout),
        stderr: result.stderr,
        bound: result.bound,
      }).toEqual({ code: 0, stdoutHasUsage: true, stderr: '', bound: false });
    },
  );

  it('REQ-047: the usage text names every supported option', async () => {
    const result = await runCli(['--help']);
    expect(OPTIONS.filter((option) => !result.stdout.includes(option))).toEqual([]);
  });
});

describe('REQ-048 — --spec is required', () => {
  it('REQ-048: options without --spec write an error and the usage to stderr and exit 2', async () => {
    const result = await runCli(['--port', '4010']);
    expect({
      code: result.code,
      stderrHasUsage: /usage/i.test(result.stderr),
      stdout: result.stdout,
    }).toEqual({ code: 2, stderrHasUsage: true, stdout: '' });
  });

  it('REQ-048: an empty --spec value is treated the same way', async () => {
    const result = await runCli(['--spec', '']);
    expect({ code: result.code, stderrHasUsage: /usage/i.test(result.stderr) }).toEqual({
      code: 2,
      stderrHasUsage: true,
    });
  });
});

describe('REQ-049 — options map to the configuration, with CLI defaults', () => {
  it('REQ-049: --host and --port map through to the bound address', async () => {
    const cli = await startCli(['--spec', SPEC, '--port', '0', '--host', '127.0.0.1']);
    try {
      const url = urlFrom(cli.stdout());
      expect({ startsWith: url?.startsWith('http://127.0.0.1:'), hasPort: /:\d+/.test(url ?? '') }).toEqual({
        startsWith: true,
        hasPort: true,
      });
    } finally {
      cli.kill('SIGKILL');
      await cli.exited;
    }
  });

  it('REQ-049: --seed reaches the generator, so two seeds give different effective seeds', async () => {
    const runs: (string | undefined)[] = [];
    for (const seed of ['42', '43']) {
      const cli = await startCli(['--spec', SPEC, '--port', '0', '--seed', seed]);
      try {
        const url = urlFrom(cli.stdout()) ?? '';
        const res = await request(url, '/pets');
        runs.push(res.header('x-mock-seed'));
      } finally {
        cli.kill('SIGKILL');
        await cli.exited;
      }
    }
    expect({ bothPresent: runs.every((s) => s !== undefined), differ: runs[0] !== runs[1] }).toEqual({
      bothPresent: true,
      differ: true,
    });
  });

  it('REQ-049: --spec with --port 0 and --seed 42 serves a generated response on an ephemeral port', async () => {
    const cli = await startCli(['--spec', SPEC, '--port', '0', '--seed', '42']);
    try {
      const url = urlFrom(cli.stdout()) ?? '';
      const res = await request(url, '/pets');
      expect({ status: res.status, payload: res.header('x-mock-payload') }).toEqual({
        status: 200,
        payload: 'generated',
      });
    } finally {
      cli.kill('SIGKILL');
      await cli.exited;
    }
  });

  it('REQ-049: --log-level silent leaves the startup line as the only line on stdout', async () => {
    const cli = await startCli(['--spec', SPEC, '--port', '0', '--log-level', 'silent']);
    try {
      const url = urlFrom(cli.stdout()) ?? '';
      await request(url, '/pets');
      await new Promise((resolve) => setTimeout(resolve, 250));
      const lines = cli.stdout().split('\n').filter((line) => line.trim() !== '');
      expect(lines.length).toBe(1);
    } finally {
      cli.kill('SIGKILL');
      await cli.exited;
    }
  });
});

describe('REQ-050 — invalid or unknown options exit with code 2', () => {
  it.each([
    ['--port', 'abc'],
    ['--seed', 'abc'],
  ])('REQ-050: %s %s writes an error naming the option and exits 2', async (option, value) => {
    const result = await runCli([option, value, '--spec', SPEC]);
    expect({ code: result.code, namesOption: result.stderr.includes(option.replace(/^--/, '')) }).toEqual({
      code: 2,
      namesOption: true,
    });
  });

  it('REQ-050: an unknown option writes an error and the usage to stderr and exits 2', async () => {
    const result = await runCli(['--colour', 'red', '--spec', SPEC]);
    expect({ code: result.code, stderrHasUsage: /usage/i.test(result.stderr) }).toEqual({
      code: 2,
      stderrHasUsage: true,
    });
  });

  it('REQ-050: an invalid option binds no port', async () => {
    const bound = await withDefaultPortLock(async () => {
      await runCli(['--port', 'abc', '--spec', SPEC]);
      return portAccepts(4010);
    });
    expect(bound).toBe(false);
  });
});

describe('REQ-051 — startup, failure reporting and shutdown', () => {
  it('REQ-051: at --log-level silent, stdout is exactly one line containing the bound URL', async () => {
    const cli = await startCli(['--spec', SPEC, '--port', '0', '--log-level', 'silent']);
    try {
      const lines = cli.stdout().split('\n').filter((line) => line.trim() !== '');
      expect({
        lines: lines.length,
        hasUrl: /http:\/\/[^:\s]+:\d+/.test(lines[0] ?? ''),
        stillRunning: cli.child.exitCode === null,
      }).toEqual({ lines: 1, hasUrl: true, stillRunning: true });
    } finally {
      cli.kill('SIGKILL');
      await cli.exited;
    }
  });

  it('REQ-051: at the default log level, stdout contains the bound URL and further lines are permitted', async () => {
    // No --log-level, so the CLI default of `info` applies (REQ-049). Nothing is asserted about
    // the number, order or content of any other line the logger writes.
    const cli = await startCli(['--spec', SPEC, '--port', '0']);
    try {
      const hasUrlLine = cli
        .stdout()
        .split('\n')
        .some((line) => /http:\/\/[^:\s]+:\d+/.test(line));
      expect({ hasUrlLine, stillRunning: cli.child.exitCode === null }).toEqual({
        hasUrlLine: true,
        stillRunning: true,
      });
    } finally {
      cli.kill('SIGKILL');
      await cli.exited;
    }
  });

  it('REQ-051: a specification that fails to load writes "CODE: " to stderr and exits 1', async () => {
    // `--port 0` keeps a server that wrongly starts off the default port, so this test cannot
    // disturb the ones that probe 4010.
    const result = await runCli(['--spec', 'qa/fixtures/unsupported-cookie-parameter.yaml', '--port', '0']);
    expect({
      code: result.code,
      stdout: result.stdout,
      startsWithCode: result.stderr.startsWith('UNSUPPORTED_CONSTRUCT: '),
    }).toEqual({ code: 1, stdout: '', startsWithCode: true });
  });

  it('REQ-051: SIGINT stops the server, releases the port and exits 0', async () => {
    const cli = await startCli(['--spec', SPEC, '--port', '0', '--log-level', 'silent']);
    const url = urlFrom(cli.stdout()) ?? '';
    const port = Number(/:(\d+)$/.exec(url)?.[1] ?? 0);

    cli.kill('SIGINT');
    const result = await cli.exited;

    // Windows has no real SIGINT delivery to a child process: Node maps `kill('SIGINT')` onto
    // TerminateProcess, so the CLI's handler never runs and the exit code is not its own. The
    // port release is observable on every platform; the exit code is asserted where it is
    // meaningful. See TEST-PLAN "Known limitations".
    const released = !(await portAccepts(port));
    expect({
      released,
      exitCode: process.platform === 'win32' ? 0 : result.code,
    }).toEqual({ released: true, exitCode: 0 });
  });
});

