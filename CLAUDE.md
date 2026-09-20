# local-mock-server — working agreement

A mock HTTP server that serves dynamic responses from a local OpenAPI 3.0.x specification.
Built with an AI-assisted SDLC: separate agents own requirements, tests, and implementation.

## Commands

```bash
npm run typecheck        # tsc --noEmit
npm run test:unit        # Developer's unit tests
npm run test:acceptance  # QA's independent acceptance suite (real HTTP)
npm test                 # full regression: unit + acceptance
npm run dev -- --spec examples/petstore.yaml --port 4010 --seed 42
```

## File ownership — binding for every agent

| Path | Owner | Everyone else |
|---|---|---|
| `docs/REQUIREMENTS.md` | Business Analyst | read only |
| `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/ACCEPTANCE-REPORT.md` | Orchestrator | read only |
| `qa/**`, `docs/TEST-PLAN.md` | QA Engineer | read only |
| `src/**`, `tests/unit/**` | Developer | read only |
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `.claude/**` | Orchestrator | read only |

**WRITING INTO A DIRECTORY YOU DO NOT OWN IS A PROCESS VIOLATION, NOT A SHORTCUT.**
It is detected by the orchestrator via `git diff --name-only` and reverted.

In particular: the Developer **must not create, edit, delete, rename or skip** anything under
`qa/`. Reading those files and running them is expected and encouraged; changing them is not.

## Non-negotiable invariants

1. **OpenAPI 3.0.x only.** 3.1.x and Swagger 2.0 are rejected at load time with
   `UNSUPPORTED_SPEC_VERSION`.
2. **Public contract is `createServer` / `start` / `stop`** (see `docs/ARCHITECTURE.md` §3).
   Acceptance tests import nothing else from `src/`.
3. **Acceptance tests use real HTTP** on an ephemeral port (`port: 0`) — never `fastify.inject()`.
4. **Acceptance tests assert schema conformance**, not generated values. Exact values are asserted
   only where the specification prescribes them (example passthrough).
5. **Fail fast.** Specification problems reject in `createServer`, before a port is bound.
6. **Deterministic.** Equal seed + equal request => equal response.
7. **Traceability.** Requirements are numbered `REQ-NNN`; every acceptance test name starts with the
   requirement id it covers, e.g. `REQ-012: rejects a request missing a required query parameter`.

## Conflict resolution

If a test appears to contradict a requirement, or a requirement appears wrong:
**STOP AND REPORT IT TO THE ORCHESTRATOR.** Do not resolve it by editing the other side's artifact.
Only the user approves changes to an already-approved requirement or acceptance test.

## Conventions

- TypeScript, ESM, Node >= 20. Imports of local modules use the `.js` extension (`NodeNext`).
- `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on — write code that
  satisfies them rather than loosening the configuration.
- Comments explain *why*, not *what*. Match the density of the surrounding code.
- Error handling goes through `MockError` (`src/errors.ts`); requirements and tests refer to error
  `code` values, never to message wording.
