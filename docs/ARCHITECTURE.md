# Architecture

Status: **approved** (baseline for requirements, tests and implementation).
Owner: Orchestrator. Business Analyst, QA Engineer and Developer read this document; none of them edits it.

## 1. Purpose

`local-mock-server` serves dynamic HTTP responses derived from a local OpenAPI 3.0.x document,
so that client integrations can be developed and tested without a real backend.

The server is **stateless**: nothing from a request is persisted, and the server keeps no session
or history.

Separately — these are two distinct properties, neither implying the other — response generation is
**deterministic**: an equal seed and an equal request produce an equal response body. Section 7
records the mechanism this requires.

## 2. Pipeline

```
CLI (node:util parseArgs)
  │
  ├─> SpecLoader        read YAML/JSON, validate document, resolve $ref
  ├─> CapabilityCheck   reject unsupported constructs — fail fast, before binding a port
  ├─> RouteTable        {petId} -> :petId, ordered by specificity (literal segments win)
  │
  └─> HTTP server (Fastify)
        ├─> RequestValidator   path / query / header / body, via AJV
        ├─> ResponseSelector   status code -> media type -> example  (honours `Prefer`)
        └─> ResponseGenerator  spec example, or generated data (json-schema-faker + seed)
```

Each stage is a separate module with an explicit input and output. No stage reaches back into a
previous one.

## 3. Public contract

`src/server.ts` exposes the **only** surface the acceptance suite may depend on:

```ts
interface MockServerConfig {
  specPath: string;                 // local OpenAPI 3.0.x document (YAML or JSON)
  port?: number;                    // default 4010; 0 = free ephemeral port
  host?: string;                    // default 127.0.0.1
  seed?: number;                    // default 1; equal seeds produce equal responses
  logLevel?: 'silent' | 'error' | 'warn' | 'info' | 'debug';  // default 'silent'
}

interface ServerAddress { url: string; host: string; port: number }

interface MockServer {
  start(): Promise<ServerAddress>;  // binds; resolves with the address actually bound
  stop(): Promise<void>;            // closes; safe to call when not started
  readonly address: ServerAddress | undefined;
}

function createServer(config: MockServerConfig): Promise<MockServer>;
```

**Fail-fast rule.** `createServer` loads, validates and analyses the specification. An unreadable,
invalid or unsupported document **rejects there**, before any port is bound, with a `MockError`
carrying a stable `code`. `start()` only binds the socket.

## 4. Rules that keep the roles independent

These two rules are the reason the process works; violating either couples QA's tests to the
Developer's implementation choices.

1. **Acceptance tests talk real HTTP.** They call `createServer({ port: 0 })`, `start()`, then use
   `fetch` against the returned URL. They never import Fastify, never use `app.inject()`, and never
   import anything from `src/` except `createServer` and its types. The HTTP framework is therefore
   replaceable without touching a single acceptance test.

2. **Acceptance tests assert schema conformance, not generated values.** A response body is checked
   by validating it against the response schema taken from the specification. Exact values are
   asserted only where the specification prescribes them — i.e. when an `example` must be echoed
   verbatim. The data generator is therefore replaceable without touching a single acceptance test.

## 5. Error model

`src/errors.ts` defines `MockError` with a stable `code`, an HTTP `status`, a human-readable
`message`, an optional JSON `pointer` into the specification and optional structured `details`.

Every error the mock server itself produces is served as `application/problem+json` with the body:

```json
{ "code": "REQUEST_VALIDATION_FAILED", "message": "...", "pointer": "#/paths/~1pets/get", "details": [] }
```

Error codes are grouped into specification-loading failures (`SPEC_NOT_FOUND`, `SPEC_INVALID`,
`UNSUPPORTED_SPEC_VERSION`, `UNSUPPORTED_CONSTRUCT`, ...) and request-handling failures
(`ROUTE_NOT_FOUND`, `REQUEST_VALIDATION_FAILED`, `NO_RESPONSE_FOR_STATUS`, ...).

**Which codes exist, and when each one is produced, is specified in `docs/REQUIREMENTS.md`.**
`src/errors.ts` implements that list. The codes it carries today are a starting vocabulary from the
bootstrap skeleton, not an approved decision. Requirements and tests refer to codes, never to
message text.

**Open for the Business Analyst.** Which HTTP status accompanies each error code, and how a client
distinguishes an error produced by the mock server itself from an error response that the
specification documents for the operation — a documented `404` and a "no such route" `404` must not
be ambiguous. This is product behaviour, not an architectural decision.

## 6. Response selection

The items below are deliberately split by who owns them. The Business Analyst must not change an
approved item, and must not treat a proposal as settled.

### Approved — not open for change

- **Control channel:** the `Prefer` request header only (decision D-002). Query parameters are
  never used for control, so they can never collide with parameters declared in the specification.

### Proposal — the Business Analyst confirms or changes each item

- **Status code:** lowest 2xx by default. `Prefer: code=NNN` selects another documented response.
- **Media type:** `application/json` if documented, otherwise the first documented media type —
  provided non-JSON media types are supported at all, which is itself the analyst's call in the
  supported / not supported table.
- **Payload precedence:** `content[mt].example` -> first of `content[mt].examples` ->
  `schema.example` -> generated data. `Prefer: example=<name>` selects a named example.

### Open question — the Business Analyst decides

- **Seed scope.** Whether the seed used for a response is the configured seed as it is, or is
  derived from the configured seed together with the identity of the request. Both satisfy the
  determinism property in §1; they differ in whether two *different* requests to the same operation
  may return the same generated data. The architecture does not prejudge this.

## 7. Technology choices

| Concern | Choice | Rationale |
|---|---|---|
| Spec parsing | `@apidevtools/swagger-parser` | Mature; YAML + JSON; document validation; `$ref` resolution; circular-reference detection |
| HTTP | `fastify` | Native TypeScript types, fast startup, structured logging |
| Validation | `ajv` + `ajv-formats` + `@openapi-contrib/openapi-schema-to-json-schema` | OAS 3.0 Schema is not JSON Schema (`nullable`, boolean `exclusiveMinimum`); the converter bridges the gap |
| Data generation | `json-schema-faker` + fixed seed | Understands formats, enums, bounds, nesting; the seed makes responses deterministic |
| CLI | `node:util` `parseArgs` | No dependency |
| Tests | `vitest` with projects `unit` and `acceptance` | TypeScript out of the box; suites separated by configuration |
| TS execution | `tsx` (dev) + `tsc` (build) | Predictable, independent of Node's type-stripping |

**Seeding.** The seed is applied per response generation — `generateSync(schema, { seed })` — and
not by creating one long-lived generator and reusing it across requests. Measured on this project
with `json-schema-faker` 0.6.3: a seeded `generateSync` call is reproducible, including across
separate processes, and covers `pattern` and `format: date-time`; generator instances share no
state, so concurrent servers with different seeds do not interfere; but a single instance created
by `createGeneratorSync` advances its internal PRNG between calls, so reusing one would make a
repeated identical request return a different body and break the determinism property in §1.

## 8. Module map

| Path | Responsibility | Owner |
|---|---|---|
| `src/cli.ts` | Argument parsing, process lifecycle | Developer |
| `src/server.ts` | Public contract, HTTP wiring | Developer |
| `src/config.ts` | Configuration defaults and resolution | Developer |
| `src/errors.ts` | Error codes, `MockError`, error body | Developer |
| `src/spec/loader.ts` | Load, validate, dereference | Developer |
| `src/spec/capabilities.ts` | Detect and report unsupported constructs | Developer |
| `src/routing/router.ts` | Path templates -> matcher, specificity ordering | Developer |
| `src/validation/request-validator.ts` | Request validation via AJV | Developer |
| `src/response/prefer.ts` | Parse the `Prefer` header | Developer |
| `src/response/selector.ts` | Status / media type / example selection | Developer |
| `src/response/generator.ts` | Example passthrough or seeded generation | Developer |

## 9. Scope boundaries

Agreed before the project started and not open for renegotiation by any agent:

- **OpenAPI 3.0.x only.** 3.1.x and Swagger 2.0 are rejected at load time with
  `UNSUPPORTED_SPEC_VERSION` and a message naming the detected version.
- Stateless. No database, no persistence, no request history.
- No web UI, no cloud deployment.
- Local execution only.
