# Architecture

Status: **approved** (baseline for requirements, tests and implementation).
Owner: Orchestrator. Business Analyst, QA Engineer and Developer read this document; none of them edits it.

## 1. Purpose

`local-mock-server` serves dynamic HTTP responses derived from a local OpenAPI 3.0.x document,
so that client integrations can be developed and tested without a real backend.

The server is **stateless**: nothing is persisted between requests. Two identical requests with the
same seed produce the same response.

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
(`ROUTE_NOT_FOUND`, `REQUEST_VALIDATION_FAILED`, `NO_RESPONSE_FOR_STATUS`, ...). The authoritative
list lives in `src/errors.ts`; requirements refer to codes, not to message text.

## 6. Response selection (baseline — the Business Analyst refines and fixes the details)

- **Status code:** lowest 2xx by default. `Prefer: code=NNN` selects another documented response.
- **Media type:** `application/json` if documented, otherwise the first documented media type.
- **Payload precedence:** `content[mt].example` -> first of `content[mt].examples` ->
  `schema.example` -> generated data. `Prefer: example=<name>` selects a named example.
- **Control channel:** the `Prefer` request header only. Query parameters are never used for
  control, so they can never collide with parameters declared in the specification.

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
