# Requirements — local-mock-server

Status: **draft for approval** (Stage 1). Owner: Business Analyst.
Baseline: `docs/ARCHITECTURE.md` (approved), `docs/DECISIONS.md` D-001..D-005, `CLAUDE.md`.
Readers: QA Engineer (writes the acceptance suite from this document), Developer (implements it).

---

## 1. Purpose and context

`local-mock-server` serves dynamic HTTP responses derived from a local OpenAPI 3.0.x document, so
that a client integration can be developed and tested without a real backend.

This document specifies **observable behaviour only**: what a black-box HTTP client sees, what the
CLI writes and exits with, and what `createServer` rejects with. It does not specify modules,
functions or data structures — those belong to `docs/ARCHITECTURE.md` §8 and to the Developer.

Every requirement carries a permanent id `REQ-NNN`. Acceptance test names begin with the id they
cover (`CLAUDE.md` invariant 7). Several tests per requirement are normal — each Given/When/Then
block below is intended to become at least one test.

Requirements refer to error **codes**, never to message wording. The code list in §4.7 is
normative; `src/errors.ts` implements it.

**What is already approved and is restated here, not re-decided:** OpenAPI 3.0.x only (D-001); the
`Prefer` request header is the only control channel (D-002); statelessness; the
`createServer` / `start` / `stop` contract with the fail-fast rule (ARCHITECTURE §3); seeded
`json-schema-faker` generation applied per generation call (D-004, ARCHITECTURE §7).

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Operation** | A (method, path template) pair declared under `paths` in the specification. |
| **Path template** | A key of `paths`, e.g. `/pets/{petId}`. |
| **Documented response** | An entry of an operation's `responses` map. |
| **Selected response** | The documented response the server chooses for a request (§4.5). |
| **Selected media type** | The key of the selected response's `content` map the server chooses (§4.5). |
| **Mock error** | An error produced by the mock server itself. Always `application/problem+json` and `X-Mock-Source: mock`. |
| **Documented error** | A 4xx/5xx response taken from the specification. Carries `X-Mock-Source: specification` and is, to the server, an ordinary response. |
| **JSON media type** | `application/json`, or any media type whose subtype ends in `+json` (e.g. `application/problem+json`, `application/vnd.acme.pet+json`). Everything else is a non-JSON media type. |
| **Construct token** | A short, stable identifier for an unsupported OpenAPI construct, reported in `details[].construct` of an `UNSUPPORTED_CONSTRUCT` error. The complete list is in §5. |
| **Request identity** | The tuple defined in REQ-054 from which the effective seed is derived. |
| **Effective seed** | The integer actually passed to the data generator for one response (REQ-054). |
| **Generating operation** | An operation whose selected response has a JSON `schema` and no example of any kind, so its payload is generated and its response carries `X-Mock-Seed`. Defined in full in REQ-054; used by REQ-052 and REQ-054. |
| **Load time** | Inside `createServer`, before any port is bound. |
| **Request time** | While answering an HTTP request on a started server. |

---

## 3. Reading the acceptance criteria

- "the server" means an instance created by `createServer(...)` and started with `start()`.
- "rejects with `CODE`" means the promise returned by `createServer` rejects with a `MockError`
  whose `code` equals `CODE`.
- "responds `NNN` / `CODE`" means the HTTP response has status `NNN`, header
  `X-Mock-Source: mock`, `Content-Type` media type `application/problem+json`, and a JSON body whose
  `code` member equals `CODE`.
- Unless stated otherwise, the specification used is `examples/petstore.yaml` and the seed is the
  default (`1`).

---

## 4. Functional requirements

### 4.1 Specification loading

---

#### REQ-001 — The specification file must exist and be readable

`createServer` rejects when `specPath` does not resolve to a readable file, before any port is
bound.

- **Given** a configuration whose `specPath` points at a path that does not exist,
  **when** `createServer` is called,
  **then** it rejects with `SPEC_NOT_FOUND`.
- **Given** a configuration whose `specPath` points at a directory,
  **when** `createServer` is called,
  **then** it rejects with `SPEC_UNREADABLE`.
- **Given** a file whose contents are neither well-formed YAML nor well-formed JSON,
  **when** `createServer` is called,
  **then** it rejects with `SPEC_UNREADABLE`.
- **Given** any of the above, **when** `createServer` has rejected,
  **then** no TCP port has been bound (see REQ-007).

---

#### REQ-002 — YAML and JSON specifications are both accepted

The document format is detected from the file contents, not from the file extension. A YAML
document and the JSON document that parses to the same object produce the same server behaviour.

- **Given** `examples/petstore.yaml`, **when** the server is started and `GET /pets` is requested,
  **then** the response status is `200`.
- **Given** a JSON file containing the JSON equivalent of `examples/petstore.yaml`, saved with any
  extension, **when** the server is started and `GET /pets` is requested,
  **then** the response status is `200` and the body validates against the same response schema.

---

#### REQ-003 — Only OpenAPI 3.0.x is accepted (D-001)

- **Given** a document with `openapi: 3.0.0`, `3.0.1`, `3.0.2`, `3.0.3` or `3.0.4`,
  **when** `createServer` is called, **then** it resolves.
- **Given** a document with `openapi: 3.1.0`, **when** `createServer` is called,
  **then** it rejects with `UNSUPPORTED_SPEC_VERSION` and the error `details` contain the detected
  version string `3.1.0`.
- **Given** a document with a root `swagger: "2.0"` key, **when** `createServer` is called,
  **then** it rejects with `UNSUPPORTED_SPEC_VERSION` and the `details` contain `2.0`.
- **Given** a document with `openapi: 4.0.0`, or with an `openapi` value that is not a string
  matching `3.0.<digits>`, **when** `createServer` is called,
  **then** it rejects with `UNSUPPORTED_SPEC_VERSION`.
- **Given** a document with no `openapi` and no `swagger` root key, **when** `createServer` is
  called, **then** it rejects with `UNSUPPORTED_SPEC_VERSION`.
- The version check happens **before** document validation and before capability checking, so a
  3.1.x document is reported as `UNSUPPORTED_SPEC_VERSION` and never as `SPEC_INVALID` or
  `UNSUPPORTED_CONSTRUCT`.

---

#### REQ-004 — The document must be a valid OpenAPI 3.0 document, with one tolerated exception

The OpenAPI 3.0 meta-schema is enforced **except** for the `ExampleXORExamples` constraint on the
Media Type Object, which forbids declaring both `example` and `examples` on the same media type.
That single constraint is **not** enforced: a document declaring both loads successfully, and
REQ-033 determines which value is served.

Declaring both is a common authoring mistake rather than a sign of a broken document, and other
mock tools tolerate it. The mock's job is to be useful against specifications as people actually
write them, so rejecting such a document would trade a working mock for meta-schema purity. No
other meta-schema constraint is relaxed.

- **Given** a 3.0.x document that violates the OpenAPI 3.0 schema (for example an operation with no
  `responses`, a `paths` key not beginning with `/`, or an unknown root field such as `webhooks`),
  **when** `createServer` is called, **then** it rejects with `SPEC_INVALID`.
- **Given** two path templates that differ only in the names of their template variables
  (`/pets/{petId}` and `/pets/{id}`), **when** `createServer` is called,
  **then** it rejects with `SPEC_INVALID`.
- **Given** a 3.0.x document that is otherwise valid but declares **both** `example` and `examples`
  on the same media type object, **when** `createServer` is called,
  **then** it **resolves** — it does not reject with `SPEC_INVALID` — and the operation is served
  with the payload REQ-033 selects.
- **Given** a valid 3.0.x document, **when** `createServer` is called, **then** it resolves.

---

#### REQ-005 — Internal `$ref` is resolved; an unresolvable `$ref` is a load-time failure

- **Given** `examples/petstore.yaml`, whose responses reference `#/components/schemas/Pet`,
  **when** `GET /pets/1` is requested with `Prefer: example=rex`,
  **then** the response body is the `rex` example — i.e. the reference was resolved.
- **Given** a document containing `$ref: '#/components/schemas/Missing'` where that schema does not
  exist, **when** `createServer` is called,
  **then** it rejects with `SPEC_REF_UNRESOLVABLE` and the error `pointer` identifies the location
  of the offending `$ref`.
- `$ref` is resolved wherever OpenAPI 3.0 permits it (schemas, parameters, request bodies,
  responses, examples, headers), not only inside schemas.
- External and circular references are **not** supported; see REQ-010.

---

#### REQ-006 — Configuration is validated, and documented defaults apply

`createServer` validates its configuration before touching the file system.

- **Given** a configuration with no `specPath`, or with a `specPath` that is not a non-empty string,
  **when** `createServer` is called, **then** it rejects with `CONFIG_INVALID`.
- **Given** a `port` that is not an integer, or is outside `0..65535`,
  **when** `createServer` is called, **then** it rejects with `CONFIG_INVALID`.
- **Given** a `seed` that is not a safe integer, **when** `createServer` is called,
  **then** it rejects with `CONFIG_INVALID`.
- **Given** a `logLevel` that is not one of `silent`, `error`, `warn`, `info`, `debug`,
  **when** `createServer` is called, **then** it rejects with `CONFIG_INVALID`.
- **Given** a configuration that omits `port`, `host`, `seed` and `logLevel`,
  **when** the server is started,
  **then** it is listening on `127.0.0.1:4010`, generated data corresponds to seed `1`, and nothing
  is written to stdout or stderr (REQ-057).
- **Given** `port: 0`, **when** `start()` resolves,
  **then** the returned `ServerAddress.port` is a non-zero port that accepts connections.

---

#### REQ-007 — Fail fast: a specification problem never binds a port (`CLAUDE.md` invariant 5)

- **Given** `port: <P>` with `<P>` a fixed free port and a specification that fails any of
  REQ-001, REQ-003, REQ-004, REQ-005, REQ-006 or REQ-009,
  **when** `createServer` is called and rejects,
  **then** a subsequent TCP connection attempt to `127.0.0.1:<P>` is refused.
- **Given** the same situation, **when** `createServer` rejects,
  **then** a second server created with a valid specification on the same `<P>` starts successfully
  — i.e. the failed attempt left no listener and no other process-wide side effect.
- `start()` never performs specification loading, validation or capability checking; the only
  failure `start()` may produce is a socket binding failure (REQ-056).

---

#### REQ-008 — Load-time errors are actionable

- **Given** any load-time rejection, **when** the `MockError` is inspected,
  **then** `code` is one of the load-time codes in §4.7 and `message` is a non-empty string.
- **Given** a rejection attributable to a location in the document (`SPEC_INVALID`,
  `SPEC_REF_UNRESOLVABLE`, `UNSUPPORTED_CONSTRUCT`), **when** the `MockError` is inspected,
  **then** `pointer` is a non-empty string beginning with `#/`.
- **Given** `SPEC_NOT_FOUND`, `SPEC_UNREADABLE`, `UNSUPPORTED_SPEC_VERSION` or `CONFIG_INVALID`,
  **then** `pointer` may be absent — tests must not require it.
- The HTTP `status` of a load-time `MockError` is not part of the contract; no requirement or test
  may depend on it.

---

### 4.2 Capability checking

---

#### REQ-009 — Unsupported constructs are rejected at load time with a structured report

The server refuses to start on a specification it cannot serve faithfully. It never starts and then
misbehaves at request time for a construct it could have detected at load time.

- **Given** a specification containing at least one construct marked *rejected at load time* in §5,
  **when** `createServer` is called,
  **then** it rejects with `UNSUPPORTED_CONSTRUCT`.
- **Given** such a rejection, **when** the `MockError` is inspected,
  **then** `details` is a non-empty array, and every element is an object with a string `construct`
  member drawn from the construct-token column of §5 and a string `pointer` member beginning
  with `#/`.
- **Given** such a rejection, **then** `MockError.pointer` equals `details[0].pointer`.

---

#### REQ-010 — The rejected constructs, and their tokens

Each criterion below is a separate specification fixture and a separate test.

- **Given** a document with a `$ref` to another file or to an `http(s)` URL,
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `externalRef`.
- **Given** a document whose `$ref` graph contains a cycle (for example a schema that references
  itself through a property),
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `circularRef`.
- **Given** a parameter with `in: cookie`,
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `cookieParameter`.
- **Given** a parameter that declares `content` instead of `schema`,
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `parameterContent`.
- **Given** a parameter whose `style` is anything other than the OpenAPI default for its location
  (`simple` for `path` and `header`, `form` for `query`), or whose `explode` differs from the
  default for that style,
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `parameterStyle`.
- **Given** a `responses` map containing a wildcard key (`1XX`, `2XX`, `3XX`, `4XX`, `5XX`),
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `responseCodeRange`.
- **Given** a named example that declares `externalValue` instead of `value`,
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `externalValue`.
- **Given** a `requestBody` whose `content` map contains no JSON media type,
  **then** `createServer` rejects with `UNSUPPORTED_CONSTRUCT`, token `nonJsonRequestBody`.

---

#### REQ-011 — All unsupported constructs are reported in one error

A user fixes a specification once, not once per construct.

- **Given** a document containing three distinct rejected constructs at three distinct locations,
  **when** `createServer` is called,
  **then** it rejects once with `UNSUPPORTED_CONSTRUCT` and `details` has exactly three elements,
  one per occurrence, each with its own `pointer`.
- **Given** the same document, **then** the `details` elements appear in document order (by the
  order in which their pointers are first encountered walking the document).

---

#### REQ-012 — Accepted-but-ignored constructs never fail the load

The constructs marked *accepted, ignored* in §5 are allowed to appear anywhere in the document. They
never cause a load-time rejection and never change the status code, headers or body of a response.

- **Given** a document that declares `components.securitySchemes` and applies `security` to an
  operation, **when** the server is started and that operation is requested **with no credentials**,
  **then** the response is the ordinary selected response (2xx), not `401` or `403`.
- **Given** a document that declares `callbacks` on an operation,
  **then** `createServer` resolves and the operation is served normally.
- **Given** a documented response that declares `headers` and `links`,
  **then** the served response carries none of those headers and no `Link` header, and is otherwise
  the ordinary selected response.
- **Given** a schema with a `discriminator`,
  **then** `createServer` resolves and generated bodies still validate against the response schema.
- **Given** an operation with `deprecated: true`,
  **then** `createServer` resolves and the operation is served normally (see REQ-037 for the
  `Deprecation` header).
- **Given** a document that declares `servers` on a path item or on an operation,
  **then** `createServer` resolves and those entries have no effect on routing (REQ-018).
  Root-level `servers` is **not** an ignored construct: its first entry may contribute a base path,
  which REQ-018 specifies in full.
- **Given** vendor extension keys (`x-...`) anywhere in the document,
  **then** `createServer` resolves and behaviour is unchanged.

---

### 4.3 Routing

---

#### REQ-013 — Every documented operation is routed at its path template

- **Given** `examples/petstore.yaml`, **when** `GET /pets` is requested,
  **then** the status is `200` and `X-Mock-Source` is `specification`.
- **Given** the same, **when** `POST /pets` is requested with a valid JSON body,
  **then** the status is `201`.
- **Given** the same, **when** `GET /pets/1` is requested, **then** the status is `200`.
- The routed methods are exactly those declared for the path item: `get`, `put`, `post`, `delete`,
  `options`, `head`, `patch`, `trace`. No method is synthesised — in particular `HEAD` is **not**
  derived from a documented `GET`, and `OPTIONS` is **not** synthesised (see REQ-017).

---

#### REQ-014 — Path parameters match exactly one path segment

- **Given** the template `/pets/{petId}`, **when** `GET /pets/1` is requested,
  **then** the status is `200`.
- **Given** the same template, **when** `GET /pets/1/toys` is requested,
  **then** the server responds `404` / `ROUTE_NOT_FOUND`.
- **Given** the same template, **when** `GET /pets/` is requested (an empty final segment),
  **then** the server responds `404` / `ROUTE_NOT_FOUND`.
- **Given** the same template, **when** `GET /pets/%31` is requested,
  **then** the parameter value is percent-decoded to `1` before validation, and the status is `200`.
- Path templates containing more than one parameter in a segment, or a parameter that is not a whole
  segment (e.g. `/files/{name}.{ext}`), are out of scope (§6) and produce `404` / `ROUTE_NOT_FOUND`
  for every request that is not a literal match.

---

#### REQ-015 — Literal segments win over template segments

- **Given** a document declaring both `/pets/mine` and `/pets/{petId}`,
  **when** `GET /pets/mine` is requested,
  **then** the response is produced by the `/pets/mine` operation.
- **Given** the same document, **when** `GET /pets/7` is requested,
  **then** the response is produced by the `/pets/{petId}` operation.
- Ordering is decided segment by segment from left to right; the first segment at which two
  candidate templates differ decides, and a literal segment always beats a template segment.

---

#### REQ-016 — An unmatched path is `ROUTE_NOT_FOUND`

- **Given** `examples/petstore.yaml`, **when** `GET /unknown` is requested,
  **then** the server responds `404` / `ROUTE_NOT_FOUND`.
- **Given** the same, **when** `GET /pets/` is requested,
  **then** the server responds `404` / `ROUTE_NOT_FOUND` — a trailing slash is significant and
  `/pets/` is not `/pets`.
- **Given** the same, **when** `GET /PETS` is requested,
  **then** the server responds `404` / `ROUTE_NOT_FOUND` — path matching is case-sensitive.
- **Given** the same, **when** `GET /` is requested,
  **then** the server responds `404` / `ROUTE_NOT_FOUND`. The server exposes no root page, no
  documentation endpoint and no health endpoint (§6).

---

#### REQ-017 — A matched path with an undocumented method is `METHOD_NOT_ALLOWED`

- **Given** `examples/petstore.yaml`, whose `/pets/{petId}` declares only `get`,
  **when** `DELETE /pets/1` is requested,
  **then** the server responds `405` / `METHOD_NOT_ALLOWED`.
- **Given** the same request, **then** the response carries an `Allow` header whose value is the
  comma-separated list of the documented methods for that path template, uppercased and in
  document order — here `GET`.
- **Given** `/pets`, which declares `get` and `post`, **when** `PUT /pets` is requested,
  **then** the `Allow` header is `GET, POST`.
- **Given** `HEAD /pets` or `OPTIONS /pets`, neither of which is documented,
  **then** the server responds `405` / `METHOD_NOT_ALLOWED`.

---

#### REQ-018 — The base path comes from the path component of `servers[0].url`

A client pointed at the mock already has its base path compiled in, so the mock honours it.

**The base path is determined once, at load time, by these rules and no others:**

1. Only the **first** entry of the **root-level** `servers` array is considered. `servers` declared
   on a path item or on an operation is ignored entirely, and so is every `servers` entry after the
   first.
2. If `servers` is absent or empty, the base path is empty.
3. If `servers[0].url` contains a template variable — any `{` or `}` character — the entry is
   ignored and the base path is empty. Routing then falls back to the `paths` keys verbatim. The
   server does **not** substitute `variables` defaults, and does not consider `servers[1]` instead.
4. Otherwise the base path is the **path component** of `servers[0].url`, taken from either an
   absolute URL (`https://api.example.com/v1`) or a relative one (`/v1`). Any query string or
   fragment in the URL is ignored.
5. Trailing slashes are stripped from the base path. A base path of `/` or `` therefore becomes
   empty. A base path that does not begin with `/` has one prepended.
6. If `servers[0].url` is not a string, or cannot be parsed as an absolute or relative URL, the
   entry is ignored and the base path is empty. This is never a load-time error.

**The route for an operation is the base path concatenated with its path template.** Everything
else in §4.3 — specificity (REQ-015), case sensitivity and trailing-slash significance (REQ-016),
`Allow` (REQ-017) — applies to that concatenated route.

- **Given** `servers: [{ url: 'https://api.example.com/v1' }]` and a path template `/pets`,
  **when** `GET /v1/pets` is requested, **then** the status is `200`.
- **Given** the same document, **when** `GET /pets` is requested,
  **then** the server responds `404` / `ROUTE_NOT_FOUND`.
- **Given** `servers: [{ url: 'https://api.example.com/v1/' }]` (a trailing slash),
  **when** `GET /v1/pets` is requested, **then** the status is `200`;
  **when** `GET /v1//pets` is requested, **then** the server responds `404` / `ROUTE_NOT_FOUND`.
- **Given** `servers: [{ url: 'http://localhost:4010' }]` (no path component) — the case in
  `examples/petstore.yaml` — **when** `GET /pets` is requested, **then** the status is `200`.
- **Given** `servers: [{ url: 'http://localhost:4010/' }]` (a path component of exactly `/`),
  **when** `GET /pets` is requested, **then** the status is `200`.
- **Given** `servers: [{ url: 'https://{tenant}.example.com/v1' }]`,
  **when** `GET /pets` is requested, **then** the status is `200`;
  **when** `GET /v1/pets` is requested, **then** the server responds `404` / `ROUTE_NOT_FOUND` —
  a templated server URL is ignored in full, including its path component.
- **Given** `servers: [{ url: '/v1' }]` (a relative URL),
  **when** `GET /v1/pets` is requested, **then** the status is `200`.
- **Given** `servers: [{ url: 'https://a.example.com/v1' }, { url: 'https://b.example.com/v2' }]`,
  **when** `GET /v1/pets` is requested, **then** the status is `200`;
  **when** `GET /v2/pets` is requested, **then** the server responds `404` / `ROUTE_NOT_FOUND` —
  only the first entry is considered.
- **Given** a root-level `servers` with no path component and a path item declaring its own
  `servers: [{ url: 'https://api.example.com/v2' }]`,
  **when** `GET /pets` is requested, **then** the status is `200`;
  **when** `GET /v2/pets` is requested, **then** the server responds `404` / `ROUTE_NOT_FOUND` —
  path-item and operation `servers` are ignored.
- **Given** a non-empty base path, **when** a request arrives at a path that does not begin with it,
  **then** the server responds `404` / `ROUTE_NOT_FOUND` — the base path is not optional.

> The base path is part of the request path, so it is part of the request identity in REQ-054 by
> way of component 3. Two servers loaded from the same document always agree on it, because it is
> derived from the document alone.

---

### 4.4 Request validation

A request is validated after routing and before response selection. Every validation failure is a
mock error (`X-Mock-Source: mock`), never a documented response — a specification that documents
`400` for bad input is not consulted to produce it. A client that wants the documented `400` asks
for it with `Prefer: code=400` (REQ-028).

---

#### REQ-019 — Path parameters are validated against their schema

- **Given** `/pets/{petId}` with `type: integer, format: int64, minimum: 1`,
  **when** `GET /pets/abc` is requested,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`, and `details` contains an entry
  with `location: "path"` and `name: "petId"`.
- **Given** the same, **when** `GET /pets/0` is requested,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`.
- **Given** the same, **when** `GET /pets/1` is requested,
  **then** the status is `200` — a path parameter that fails validation is `422`, never `404`.
- Path parameter values are coerced from their string form to the declared primitive type
  (`integer`, `number`, `boolean`) before the schema is applied.

---

#### REQ-020 — Query parameters are validated; undeclared query parameters are ignored

- **Given** an operation with a required query parameter, **when** it is requested without that
  parameter, **then** the server responds `422` / `REQUEST_VALIDATION_FAILED` with a `details` entry
  whose `location` is `"query"` and whose `name` is the parameter name.
- **Given** `/pets` with `limit` (`integer`, `minimum: 1`, `maximum: 100`),
  **when** `GET /pets?limit=0` or `GET /pets?limit=abc` is requested,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`.
- **Given** the same, **when** `GET /pets?limit=20` is requested, **then** the status is `200`.
- **Given** `/pets` with `status` constrained by `enum: [available, pending, sold]`,
  **when** `GET /pets?status=unknown` is requested,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`.
- **Given** the same, **when** `GET /pets?colour=red` is requested,
  **then** the status is `200` — a query parameter the specification does not declare is ignored and
  is never an error.
- **Given** an optional parameter with a `default`, **when** the request omits it,
  **then** the request is valid and the response is unaffected: the server does not inject default
  values and does not require them.
- **Given** an array-typed query parameter with the default `form`/`explode: true` style,
  **when** it is supplied as repeated `name=value` pairs,
  **then** the collected values are validated against the array schema, including `minItems`,
  `maxItems` and `items`.
- Parameters declared on the path item apply to every operation of that path item; a parameter
  declared on the operation with the same `name` and `in` replaces the path-item one.

---

#### REQ-021 — Header parameters are validated, case-insensitively by name

- **Given** an operation with a required `in: header` parameter `X-Request-Id`,
  **when** it is requested without that header,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED` with a `details` entry whose
  `location` is `"header"`.
- **Given** the same, **when** the header is sent as `x-request-id`,
  **then** it is accepted — header names match case-insensitively.
- **Given** a header parameter with a constrained schema, **when** a value violating it is sent,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`.
- `Accept`, `Content-Type`, `Authorization` and `Prefer` are never validated as header parameters
  even if the specification declares them; declaring them is not an error.

---

#### REQ-022 — Request bodies are validated against the documented schema

- **Given** `POST /pets` with `requestBody.required: true`, **when** it is requested with no body,
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED` with a `details` entry whose
  `location` is `"body"`.
- **Given** the same, **when** it is requested with `{"status":"available"}` (missing the required
  `name`), **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`.
- **Given** the same, **when** it is requested with `{"name":""}` (violating `minLength: 1`),
  **then** the server responds `422` / `REQUEST_VALIDATION_FAILED`.
- **Given** the same, **when** it is requested with `{"name":"Rex"}`,
  **then** the status is `201`.
- **Given** an operation whose `requestBody.required` is absent or `false`,
  **when** it is requested with no body, **then** the request is valid.
- **Given** an operation that declares no `requestBody`, **when** a body is sent anyway,
  **then** the body is ignored and the request is valid.

---

#### REQ-023 — An undocumented request media type is `415`

- **Given** `POST /pets`, whose `requestBody.content` declares only `application/json`,
  **when** a body is sent with `Content-Type: text/plain`,
  **then** the server responds `415` / `UNSUPPORTED_REQUEST_MEDIA_TYPE`, and `details` names the
  documented media types.
- **Given** the same, **when** a body is sent with `Content-Type: application/json; charset=utf-8`,
  **then** the media type matches (parameters after `;` are ignored) and the request is validated
  normally.
- **Given** the same, **when** a non-empty body is sent with no `Content-Type` header at all,
  **then** the body is parsed as `application/json`.

---

#### REQ-024 — A malformed JSON request body is `400`

- **Given** `POST /pets`, **when** a body of `{"name":` is sent with `Content-Type: application/json`,
  **then** the server responds `400` / `MALFORMED_REQUEST_BODY`.
- `MALFORMED_REQUEST_BODY` is produced only when the bytes cannot be parsed as JSON. A parseable
  body that violates the schema is `422` / `REQUEST_VALIDATION_FAILED` (REQ-022).

---

#### REQ-025 — `readOnly` and `writeOnly` have explicit, opposite effects

- **Given** a request body schema with a property marked `readOnly: true` that is also listed in
  `required`, **when** a request omits that property,
  **then** the request is valid — `readOnly` properties are removed from `required` for request
  validation.
- **Given** the same, **when** a request supplies that property with a schema-valid value,
  **then** the request is valid; the value is ignored.
- **Given** a response schema with a property marked `writeOnly: true`,
  **when** a response body is generated from it,
  **then** that property is absent from the body (see REQ-039).

---

#### REQ-026 — Validation failures report every violation, in a stable shape

- **Given** a request that violates three constraints at once (say a bad path parameter, a bad query
  parameter and a bad body), **when** it is requested,
  **then** the single `422` / `REQUEST_VALIDATION_FAILED` response has a `details` array with one
  entry per violation.
- **Given** any `REQUEST_VALIDATION_FAILED` response, **when** `details` is inspected,
  **then** every element is an object with:
  `location` (one of `"path"`, `"query"`, `"header"`, `"body"`), `message` (non-empty string),
  `schemaPath` (non-empty string), and — for `path`, `query` and `header` — `name` (the parameter
  name). For `body`, an `instancePath` member locates the offending member within the body.
- Tests assert on `location`, `name` and the presence of `message`; they never assert message text.

---

### 4.5 Response selection

Selection order is fixed: **status code → media type → payload**. Each step is decided
independently and only the `Prefer` header may steer it (D-002). Query parameters never steer it.

---

#### REQ-027 — The default status code is the lowest documented 2xx

- **Given** an operation documenting `200` and `400`, **when** it is requested with no `Prefer`
  header, **then** the response status is `200`.
- **Given** an operation documenting `201`, `202` and `400`, **when** it is requested with no
  `Prefer` header, **then** the response status is `201`.
- **Given** an operation documenting `301`, `404` and `500` and no 2xx,
  **when** it is requested with no `Prefer` header, **then** the response status is `301` — the
  lowest documented numeric status.
- **Given** an operation documenting only `default`,
  **when** it is requested with no `Prefer` header, **then** the response status is `200` and the
  body comes from the `default` response.
- **Given** an operation documenting `default` alongside numeric codes,
  **then** `default` is used only when no numeric code is documented; it is never selected by
  default otherwise.

---

#### REQ-028 — `Prefer: code=NNN` selects a documented response

- **Given** `GET /pets/{petId}`, which documents `200` and `404`,
  **when** it is requested with `Prefer: code=404`,
  **then** the response status is `404`, `X-Mock-Source` is `specification`, and the body is the
  `404` response's payload — *not* a mock error.
- **Given** `GET /pets`, which documents `200` and `400`,
  **when** it is requested with `Prefer: code=400`,
  **then** the response status is `400` and `X-Mock-Source` is `specification`.
- **Given** an operation documenting `default`, **when** it is requested with `Prefer: code=default`,
  **then** the server responds `400` / `INVALID_PREFER_HEADER` — the `code` directive takes a
  three-digit numeric status only (REQ-035).

---

#### REQ-029 — An undocumented preferred status is `NO_RESPONSE_FOR_STATUS`

The server never silently ignores an unsatisfiable `code` preference: a test that asked for a
response the specification does not document must fail loudly.

- **Given** `GET /pets/{petId}`, which documents `200` and `404`,
  **when** it is requested with `Prefer: code=500`,
  **then** the server responds `400` / `NO_RESPONSE_FOR_STATUS`, and `details` lists the statuses the
  operation does document.
- **Given** an operation documenting `default` and `200`, **when** it is requested with
  `Prefer: code=500`, **then** the server responds `400` / `NO_RESPONSE_FOR_STATUS` — `default` does
  not make every status available.

---

#### REQ-030 — Media type selection prefers `application/json`

- **Given** a selected response whose `content` declares `application/json` and `text/plain`,
  **then** `application/json` is served.
- **Given** a selected response whose `content` declares `text/plain` and
  `application/vnd.acme+json` in that order, **then** `application/vnd.acme+json` is served —
  non-JSON media types are skipped.
- **Given** a selected response whose `content` declares `application/hal+json` and
  `application/problem+json` in that order, and no `application/json`,
  **then** `application/hal+json` is served — the first JSON media type in document order.
- The request's `Accept` header is **ignored** for media type selection (§6). A request with
  `Accept: text/plain` receives the same JSON response as a request with no `Accept` header.

---

#### REQ-031 — A selected response with content but no JSON media type is `406`

- **Given** a selected response whose `content` declares only `text/plain` and `application/xml`,
  **when** the operation is requested,
  **then** the server responds `406` / `NO_SUPPORTED_MEDIA_TYPE`, and `details` lists the documented
  media types.
- This is a request-time failure, not a load-time one: a specification that offers non-JSON
  representations still loads and its JSON operations still work.

---

#### REQ-032 — A response with no content is served with an empty body

- **Given** a selected response with no `content` member, or with an empty `content` map
  (for example a `204`), **when** the operation is requested,
  **then** the status is the selected status, the body is empty (zero bytes), no `Content-Type`
  header is sent, `X-Mock-Source` is `specification`, and `X-Mock-Payload` is `none`.

---

#### REQ-033 — Payload precedence within the selected media type

With no `Prefer: example` directive, the payload is the first of the following that exists:

1. `content[mediaType].example`
2. the **first** entry of `content[mediaType].examples`, in document order, taking its `value`
3. `content[mediaType].schema.example`
4. data generated from `content[mediaType].schema` (§4.6)

Levels 1 and 2 can only both apply to a document that the OpenAPI 3.0 meta-schema's
`ExampleXORExamples` constraint forbids. Such a document is **deliberately accepted** rather than
rejected (REQ-004), precisely so that this precedence rule has something to govern; level 1 then
wins.

Acceptance criteria:

- **Given** `GET /pets/{petId}` with `Prefer: code=404`, whose `404` response declares
  `example: {code: NOT_FOUND, message: Pet not found.}`,
  **when** it is requested,
  **then** the body is byte-equivalent to that example (deep JSON equality) and `X-Mock-Payload`
  is `example`.
- **Given** `GET /pets/1`, whose `200` response declares `examples` with `rex` first and `mittens`
  second and no `example`, **when** it is requested with no `Prefer` header,
  **then** the body equals the `rex` example value and `X-Mock-Payload` is `example`.
- **Given** an operation whose selected media type declares both `example` and `examples` — a
  combination the meta-schema forbids and REQ-004 tolerates — **when** it is requested with no
  `Prefer` header, **then** the body equals the `example` value, not any entry of `examples`, and
  `X-Mock-Payload` is `example`.
- **Given** the same operation, **when** it is requested with `Prefer: example=<name>` naming an
  entry of its `examples` map, **then** the body equals that named entry's value — an explicit
  `Prefer: example` directive overrides the precedence order (REQ-034).
- **Given** `GET /pets`, whose `200` response declares neither `example` nor `examples` nor
  `schema.example`, **when** it is requested,
  **then** the body validates against the response schema and `X-Mock-Payload` is `generated`.
- **Given** a selected media type with an `example` whose value does not satisfy the schema,
  **then** the example is served as-is and no error is raised: the specification's word is final.

---

#### REQ-034 — `Prefer: example=<name>` selects a named example

- **Given** `GET /pets/1` with `Prefer: example=mittens`,
  **then** the body equals the `mittens` example value and `X-Mock-Payload` is `example`.
- **Given** `GET /pets/1` with `Prefer: example=nosuch`,
  **then** the server responds `400` / `EXAMPLE_NOT_FOUND`, and `details` lists the available
  example names for the selected media type.
- **Given** an operation whose selected media type declares no `examples` map at all,
  **when** it is requested with `Prefer: example=anything`,
  **then** the server responds `400` / `EXAMPLE_NOT_FOUND`.
- **Given** `Prefer: code=404, example=notFound`,
  **then** the example is looked up in the `404` response's selected media type — the `code`
  directive is applied first.
- Example names are matched case-sensitively and exactly.

---

#### REQ-035 — `Prefer` parsing rules

- All `Prefer` request header field values are concatenated with `,` and then split on top-level
  commas; each token is `name` or `name=value` with optional surrounding whitespace.
- Directive **names** are matched case-insensitively (`PREFER: Code=404` works). Directive **values**
  are used verbatim, except that a surrounding pair of double quotes is stripped
  (`Prefer: code="404"` is equivalent to `Prefer: code=404`).
- The only directives the server acts on are `code` and `example`. Any other directive
  (`wait`, `respond-async`, `handling`, …) is **ignored** and never causes an error.
- `code` must be exactly three ASCII digits forming a value in `100..599`.
- `example` must be a non-empty string.

Acceptance criteria:

- **Given** `Prefer:  code = 404 ,  example = notFound `, **then** both directives are applied.
- **Given** `Prefer: respond-async, code=404`, **then** the `404` response is selected and no error
  is raised.
- **Given** `Prefer: code=abc`, `Prefer: code=40`, `Prefer: code=1000`, `Prefer: code=` or
  `Prefer: code=099`, **then** the server responds `400` / `INVALID_PREFER_HEADER`.
- **Given** `Prefer: example=`, **then** the server responds `400` / `INVALID_PREFER_HEADER`.
- **Given** `Prefer: code=200, code=404` (the same known directive twice),
  **then** the server responds `400` / `INVALID_PREFER_HEADER`.
- **Given** no `Prefer` header, or an empty `Prefer` header value,
  **then** default selection applies and no error is raised.
- `INVALID_PREFER_HEADER` is evaluated after routing and request validation: a request that is both
  invalid and carries a malformed `Prefer` header is reported as
  `422` / `REQUEST_VALIDATION_FAILED`.

---

#### REQ-036 — An applied preference is echoed in `Preference-Applied`

- **Given** a request with `Prefer: code=404` that was honoured,
  **then** the response carries `Preference-Applied: code=404`.
- **Given** a request with `Prefer: code=404, example=notFound` that was honoured,
  **then** the response carries `Preference-Applied: code=404, example=notFound`, listing only the
  directives the server acted on, in the order `code`, `example`.
- **Given** a request with no `Prefer` header, or with only ignored directives,
  **then** the response carries no `Preference-Applied` header.

---

#### REQ-037 — A deprecated operation is marked in the response

- **Given** an operation with `deprecated: true`, **when** it is requested,
  **then** the response is the ordinary selected response and carries the header
  `Deprecation: true`.
- **Given** an operation without `deprecated`, or with `deprecated: false`,
  **then** the response carries no `Deprecation` header.

---

### 4.6 Data generation

---

#### REQ-038 — A generated body conforms to the response schema

- **Given** `GET /pets` with the default seed, **when** it is requested,
  **then** the body validates against `#/paths/~1pets/get/responses/200/content/application~1json/schema`
  — an array of 1 to 5 `Pet` objects, each with `id`, `name` and `status` present.
- **Given** the same, **then** every generated `status` is one of `available`, `pending`, `sold`,
  every `name` has length 1..40, every `id` is an integer >= 1, and `tags`, when present, has at
  most 4 items.
- **Given** a schema using `allOf`, `oneOf` or `anyOf`, **then** the generated body validates
  against that schema.
- **Given** a schema with `additionalProperties: false`, **then** the generated body contains no
  property outside `properties`.
- **Given** a schema with a `format` from the supported list in §5, **then** the generated value
  satisfies that format. **Given** an unrecognised `format`, **then** it is ignored and the
  generated value satisfies the remaining constraints of the schema.
- Tests assert schema conformance, never specific generated values (D-005).

---

#### REQ-039 — `writeOnly` properties are never generated

- **Given** a response schema with a property marked `writeOnly: true`, including one listed in
  `required`, **when** a body is generated from it,
  **then** that property is absent from the generated body.
- This is the only case in which a generated body may omit a `required` property.

---

#### REQ-040 — A generation failure is reported, not hidden

- **Given** a schema the generator cannot satisfy (for example mutually contradictory constraints
  such as `minLength: 5` together with `maxLength: 2`), **when** the operation is requested,
  **then** the server responds `500` / `GENERATION_FAILED`, and `pointer` identifies the schema.
- The server never returns a 2xx with a body that does not validate against the schema it was
  generated from.

---

#### REQ-041 — Response `Content-Type`

- **Given** any response with a body taken from the specification (example or generated),
  **then** the `Content-Type` header is present and its media type — the part before any `;` —
  equals the selected media type exactly.
- **Given** any mock error response, **then** the `Content-Type` media type is
  `application/problem+json`.
- Parameters after `;` (such as `charset=utf-8`) are permitted and are not asserted by tests.

---

### 4.7 Error model and disambiguation

---

#### REQ-042 — Every mock error has the same body shape

- **Given** any response with `X-Mock-Source: mock`, **when** the body is parsed as JSON,
  **then** it is an object with a string `code` drawn from the request-time code list below and a
  non-empty string `message`.
- **Given** the same, **then** `pointer`, when present, is a string beginning with `#/`, and
  `details`, when present, is an array or object as specified by the requirement that produces the
  code.
- The body contains no other top-level members.

---

#### REQ-043 — Every response declares its origin

- **Given** any HTTP response from a started server, **then** exactly one `X-Mock-Source` header is
  present, with the value `specification` or `mock`.
- `specification` means the status code, media type and body come from the OpenAPI document (whether
  the body is an example or generated from a schema).
- `mock` means the response is a mock error produced by the server itself.
- The `X-Mock-` header name prefix is **reserved by the server**. The server never emits an
  `X-Mock-*` header whose name or value is taken from the specification, and a response header the
  specification declares with such a name is never emitted under any circumstances. This holds
  independently of how many documented response headers the server emits, so it does not have to be
  restated if that changes.
- Separately, and as a scope decision of this MVP rather than a property of the reserved prefix,
  documented response headers are not emitted at all (REQ-012, §6, §7).

---

#### REQ-044 — Generated responses expose how they were produced

- **Given** any response with `X-Mock-Source: specification`, **then** an `X-Mock-Payload` header is
  present with exactly one of the values `example`, `generated`, `none`.
- The value maps onto the four precedence levels of REQ-033 as follows. **All three example levels
  yield `example`** — the payload came from the specification, not from the generator, and the
  server draws no distinction between them:

  | REQ-033 level | Payload source | `X-Mock-Payload` | `X-Mock-Seed` |
  |---|---|---|---|
  | 1 | `content[mt].example` | `example` | absent |
  | 2 | first of `content[mt].examples`, or the one named by `Prefer: example=<name>` | `example` | absent |
  | 3 | `content[mt].schema.example` | `example` | absent |
  | 4 | data generated from `content[mt].schema` | `generated` | present |
  | — | the selected response has no `content` (REQ-032) | `none` | absent |

- **Given** a response with `X-Mock-Payload: generated`, **then** an `X-Mock-Seed` header is present
  whose value is the decimal representation of the effective seed (REQ-054), an integer in
  `0..4294967295`.
- **Given** a response with `X-Mock-Payload: example` or `none`, **then** no `X-Mock-Seed` header is
  present. In particular, **given** a selected response whose only example is a `schema.example`
  (REQ-033 level 3), **then** `X-Mock-Payload` is `example` and no `X-Mock-Seed` header is present,
  because no seed was consumed.
- **Given** a response with `X-Mock-Source: mock`, **then** neither `X-Mock-Payload` nor
  `X-Mock-Seed` is present.

---

#### REQ-045 — Error codes and their HTTP statuses

This table is normative. `src/errors.ts` declares exactly these codes and no others; the bootstrap
placeholder `NOT_IMPLEMENTED` is removed.

**Load time — rejects `createServer`; no HTTP status.**

| Code | Produced when | Requirement |
|---|---|---|
| `CONFIG_INVALID` | The configuration passed to `createServer` is not valid. | REQ-006 |
| `SPEC_NOT_FOUND` | `specPath` does not exist. | REQ-001 |
| `SPEC_UNREADABLE` | `specPath` exists but cannot be read, or cannot be parsed as YAML or JSON. | REQ-001 |
| `UNSUPPORTED_SPEC_VERSION` | The document is not OpenAPI 3.0.x. | REQ-003 |
| `SPEC_INVALID` | The document is 3.0.x but violates the OpenAPI 3.0 specification. | REQ-004 |
| `SPEC_REF_UNRESOLVABLE` | A `$ref` cannot be resolved within the document. | REQ-005 |
| `UNSUPPORTED_CONSTRUCT` | The document uses a construct listed as rejected in §5. | REQ-009, REQ-010 |

**Request time — served as `application/problem+json` with `X-Mock-Source: mock`.**

| Code | HTTP status | Produced when | Requirement |
|---|---|---|---|
| `ROUTE_NOT_FOUND` | 404 | No path template matches the request path. | REQ-016 |
| `METHOD_NOT_ALLOWED` | 405 | The path template matches but the method is not documented. Carries `Allow`. | REQ-017 |
| `MALFORMED_REQUEST_BODY` | 400 | The request body is not parseable JSON. | REQ-024 |
| `UNSUPPORTED_REQUEST_MEDIA_TYPE` | 415 | The request `Content-Type` is not documented for the operation. | REQ-023 |
| `REQUEST_VALIDATION_FAILED` | 422 | A path, query or header parameter, or the request body, violates the specification. | REQ-019..REQ-022, REQ-026 |
| `INVALID_PREFER_HEADER` | 400 | The `Prefer` header is syntactically invalid, or a known directive has a malformed value. | REQ-035 |
| `NO_RESPONSE_FOR_STATUS` | 400 | `Prefer: code=NNN` names a status the operation does not document. | REQ-029 |
| `EXAMPLE_NOT_FOUND` | 400 | `Prefer: example=<name>` names an example that does not exist in the selected media type. | REQ-034 |
| `NO_SUPPORTED_MEDIA_TYPE` | 406 | The selected response has content but no JSON media type. | REQ-031 |
| `GENERATION_FAILED` | 500 | Data generation failed or produced a value that does not validate. | REQ-040 |

- **Given** each row of the request-time table, **when** the corresponding condition is triggered,
  **then** the response status equals the status in the table.
- No mock error uses a status outside `{400, 404, 405, 406, 415, 422, 500}`.

> **Note on 422.** `REQUEST_VALIDATION_FAILED` uses `422 Unprocessable Content` rather than `400`
> so that the most common mock error — a request that does not match the specification — is
> distinguishable from a documented `400` by status alone, without reading a header. The other
> client-fault codes use `400` because they concern the *control channel*, not the request body.

---

#### REQ-046 — A documented error is never confused with a mock error

This is the disambiguation rule the architecture (§5) left open. Three independent signals separate
the two, and a client may rely on any of them:

1. the `X-Mock-Source` header (`specification` vs `mock`) — present on every response (REQ-043);
2. the response media type — a mock error is always `application/problem+json` (REQ-041);
3. the body shape — a mock error body always has a `code` member drawn from the request-time table
   in REQ-045 (REQ-042).

Acceptance criteria, all on `examples/petstore.yaml`, whose `GET /pets/{petId}` documents a `404`:

- **Given** `GET /pets/1` with `Prefer: code=404`, **then** the status is `404`, `X-Mock-Source` is
  `specification`, the `Content-Type` media type is `application/json`, and the body equals the
  documented example `{"code":"NOT_FOUND","message":"Pet not found."}`.
- **Given** `GET /nosuchpath`, **then** the status is `404`, `X-Mock-Source` is `mock`, the
  `Content-Type` media type is `application/problem+json`, and the body's `code` is
  `ROUTE_NOT_FOUND`.
- **Given** the two responses above, **then** they are distinguishable by `X-Mock-Source` alone, by
  `Content-Type` alone, and by the value of the body's `code` member alone.
- **Given** a specification that documents `application/problem+json` for its own `404` response,
  **when** that response is selected with `Prefer: code=404`,
  **then** `X-Mock-Source` is `specification` — the header remains authoritative even when the media
  type coincides.

---

### 4.8 Command line interface

The CLI is a thin wrapper over the public contract. Its observable surface is: stdout, stderr and
the process exit code.

---

#### REQ-047 — Usage output

- **Given** the CLI is invoked with `--help`, or with `-h`, or with no arguments at all,
  **then** usage text is written to **stdout**, nothing is written to stderr, the process exits with
  code `0`, and no port is bound.
- **Given** the same, **then** the usage text names every supported option: `--spec`/`-s`,
  `--port`/`-p`, `--host`, `--seed`, `--log-level`, `--help`/`-h`.

---

#### REQ-048 — `--spec` is required

- **Given** the CLI is invoked with options but without `--spec` (for example `--port 4010`),
  **then** an error line and the usage text are written to **stderr**, and the process exits with
  code `2`.
- **Given** the CLI is invoked with `--spec` and an empty value, **then** the same applies.

---

#### REQ-049 — Options map to the configuration, with CLI defaults

- `--spec <path>` → `specPath`; `--port <n>` → `port`; `--host <addr>` → `host`;
  `--seed <n>` → `seed`; `--log-level <lvl>` → `logLevel`.
- **Given** `--spec examples/petstore.yaml --port 0 --seed 42`, **then** the server starts on an
  ephemeral port and generated responses correspond to seed `42`.
- **Given** no `--log-level`, **then** the CLI uses `info`. This differs deliberately from the
  library default of `silent` (REQ-006): a user running the process interactively expects a startup
  line and request logging; an embedded test does not.
- **Given** `--log-level silent`, **then** the only line written to stdout is the startup line of
  REQ-051.

---

#### REQ-050 — Invalid or unknown options exit with code 2

- **Given** `--port abc` or `--seed abc`, **then** an error line naming the option is written to
  stderr and the process exits with code `2`.
- **Given** an unknown option such as `--colour`, **then** an error line and the usage text are
  written to stderr and the process exits with code `2`.
- **Given** any of the above, **then** no port is bound.

---

#### REQ-051 — Startup, failure reporting and shutdown

- **Given** a valid specification and `--log-level silent`, **when** the CLI starts successfully,
  **then** **exactly one** line is written to stdout, that line contains the bound URL in the form
  `http://<host>:<port>`, and the process stays alive.
- **Given** a valid specification at any other log level — including the CLI default of `info`
  (REQ-049) — **when** the CLI starts successfully,
  **then** stdout contains a line with the bound URL in the form `http://<host>:<port>`, and the
  process stays alive. Further lines written by the logger are permitted; no test may assert on
  their number, order or content (REQ-057).

> The line count is asserted only at `silent` because that is the only level at which the CLI owns
> stdout exclusively. The alternative — making `silent` the CLI default so the single-line rule
> could hold unconditionally — was rejected: a tool that prints nothing on a successful start looks
> broken, and REQ-049 sets the CLI default to `info` deliberately. The startup line itself is
> required at every level, so the behaviour a user depends on is unconditional; only the exclusivity
> of stdout is scoped.

- **Given** a specification that fails to load, **when** the CLI is run,
  **then** a line beginning with the error `code` followed by `: ` is written to **stderr**, nothing
  is written to stdout, and the process exits with code `1`.
- **Given** a running CLI process, **when** it receives `SIGINT` or `SIGTERM`,
  **then** the server stops, the listening port is released, and the process exits with code `0`.

---

## 5. Non-functional requirements

---

#### REQ-052 — Determinism (`CLAUDE.md` invariant 6)

Equal seed plus equal request produce an equal response body. This is a hard guarantee, not a
best-effort one, and it is what makes the acceptance suite stable.

Throughout this requirement, *"the same request"* means the same method, the same path, the same
query string and the same `Prefer` header. The criteria that assert on `X-Mock-Seed` are stated
against a **generating operation** (defined in REQ-054), because only a generated payload carries
that header (REQ-044); the criteria that assert only on the body hold for any operation.

- **Given** a server with `seed: 42`, **when** the same request is issued twice,
  **then** the two response bodies are byte-identical.
- **Given** a server with `seed: 42` and a generating operation, **when** the same request to it is
  issued twice, **then** both responses carry `X-Mock-Payload: generated` and equal `X-Mock-Seed`
  values, and the bodies are byte-identical.
- **Given** two servers created in the **same process** from the same specification with
  `seed: 42`, **when** the same request is issued to each,
  **then** the response bodies are byte-identical.
- **Given** two servers started in **separate processes** from the same specification with
  `seed: 42`, **when** the same request is issued to each,
  **then** the response bodies are byte-identical.
- **Given** a server with `seed: 42` and another with `seed: 43`, and a generating operation,
  **when** the same request to it is issued to each,
  **then** the `X-Mock-Seed` values differ. (The bodies are expected to differ too, but a test must
  not assert that: a sufficiently constrained schema may admit only one value.)
- **Given** a server with `seed: 42` and another with `seed: 43`, **when** the same request is
  issued to each for an operation whose payload is an example (REQ-033 levels 1–3),
  **then** the two bodies are byte-identical — the seed cannot influence a payload the
  specification prescribes. On `examples/petstore.yaml`, `GET /pets/1` is such a request.
- **Given** interleaved requests to other operations between two identical requests,
  **then** the two identical requests still return byte-identical bodies — no generator state
  carries over between responses (ARCHITECTURE §7).

---

#### REQ-053 — Concurrent and repeated instances do not interfere

- **Given** two servers running simultaneously in the same process on different ephemeral ports with
  different seeds, **when** requests are issued to both, alternating,
  **then** each server's responses are exactly those it would have produced alone (REQ-052).
- **Given** ten concurrent identical requests to one server,
  **then** all ten response bodies are byte-identical.

---

#### REQ-054 — Seed scope: the effective seed is derived from the seed and the request

*This settles the open question in `docs/ARCHITECTURE.md` §6.*

**Decision.** The effective seed is **derived** from the configured seed together with the identity
of the request — not the configured seed as it stands.

The **request identity** is exactly this tuple, and nothing else:

1. the configured `seed`;
2. the HTTP method, uppercased;
3. the request path, percent-decoded, case-sensitive (e.g. `/pets/7`);
4. the query string, normalised: every supplied parameter — declared or not — as `name=value`,
   sorted by name and then by value, joined with `&`; empty when there is no query string;
5. the selected status code, as served;
6. the selected media type, as served.

The derivation must be a **pure function of those six components only**: no clock, no counter, no
process id, no request ordering, no random source, no header other than as it affects (5) and (6).
Its result is an integer in `0..4294967295` and is published as `X-Mock-Seed` (REQ-044).

**Stated consequence.** Two *different* requests to the same operation are generated with different
effective seeds and therefore need not return the same data; two *identical* requests always do
(REQ-052). Concretely, for an operation at `/things/{id}` whose response is generated, `GET
/things/1` and `GET /things/2` are independent draws, which is what makes the mock usable as a
stand-in for a real collection. The cost is that the generated body for a given operation is not a
single fixed document — a client must not hard-code a value it saw for one path and expect it at
another. Where a fixed value is needed, the specification must provide an example (REQ-033).

**The specification these criteria require.** The effective seed is observable only where a payload
is actually generated, so the criteria below are stated against a **generating operation**:

> **Generating operation** — an operation whose selected response declares `content` for a JSON
> media type with a `schema`, and declares **no** `example`, **no** `examples` map and **no**
> `schema.example`. By REQ-033 its payload is therefore generated (level 4), and by REQ-044 its
> response carries `X-Mock-Payload: generated` and an `X-Mock-Seed` header.

Two shapes are needed, and one specification may provide both:

- **G1** — a generating operation at a **templated** path, written below as `GET /things/{id}`, for
  the criteria that vary the path.
- **G2** — a generating operation declaring at least two **optional** query parameters, for the
  criteria that vary the query string.

`examples/petstore.yaml`'s `GET /pets` is a G2 generating operation: its `200` response declares a
schema and no example of any kind, and it declares the optional `limit` and `status` parameters.
Its `GET /pets/{petId}` is **not** a generating operation — it declares an `examples` map, so by
REQ-033 its payload is the `rex` example and by REQ-044 it carries no `X-Mock-Seed`. Criteria that
need G1 therefore name no existing file; QA supplies a specification of the shape described.

Acceptance criteria:

- **Given** a server with any seed loaded from a specification providing **G1**,
  **when** `GET /things/1` and `GET /things/2` are requested,
  **then** both responses carry `X-Mock-Payload: generated` and their `X-Mock-Seed` values differ —
  the path is part of the identity (component 3).
- **Given** the same server, **when** `GET /things/1` is requested twice,
  **then** the two `X-Mock-Seed` values are equal and the bodies are byte-identical (REQ-052).
- **Given** a server loaded from `examples/petstore.yaml` (whose `GET /pets` is **G2**),
  **when** `GET /pets?limit=1` and `GET /pets?limit=2` are requested,
  **then** both responses carry `X-Mock-Payload: generated` and their `X-Mock-Seed` values differ —
  the query string is part of the identity (component 4).
- **Given** the same server, **when** `GET /pets?limit=1&status=sold` and
  `GET /pets?status=sold&limit=1` are requested,
  **then** their `X-Mock-Seed` values are **equal** and their bodies are byte-identical — query
  parameter order is not part of the identity.
- **Given** the same server, **when** `GET /pets` is requested with `Prefer: code=200` and then with
  no `Prefer` header (both selecting `200`),
  **then** the `X-Mock-Seed` values are equal and the bodies are byte-identical — the `Prefer`
  header influences identity only through the status and media type it selects.
- **Given** the same server, **when** `GET /pets` is requested twice with no `Prefer` header,
  **then** the `X-Mock-Seed` values are equal (REQ-052).

---

#### REQ-055 — Statelessness (ARCHITECTURE §1)

Nothing from a request is retained. The server keeps no session, no history and no store.

- **Given** a server, **when** `POST /pets` is requested with `{"name":"Rex"}` and then `GET /pets`
  is requested, **then** the `GET /pets` response is byte-identical to the response the same
  `GET /pets` returns on a freshly started server with the same seed.
- **Given** a server, **when** `POST /pets` is requested twice with different bodies and `GET /pets`
  is requested after each, **then** the two `GET /pets` responses are byte-identical.
- **Given** a server, **when** `GET /pets/1` is requested, **then** the response never reflects any
  earlier `POST`, `PUT` or `PATCH`.
- No file is created or modified anywhere on disk while the server is running.

---

#### REQ-056 — Lifecycle contract (ARCHITECTURE §3)

- **Given** a server created but not started, **then** `address` is `undefined`.
- **Given** `start()` has resolved, **then** it resolved with `{ url, host, port }` where `port` is
  the port actually bound, `host` is the host actually bound, `url` is `http://<host>:<port>`, and
  `address` returns the same object contents.
- **Given** `stop()` has resolved, **then** the port no longer accepts connections and `address` is
  `undefined`.
- **Given** a server that was never started, **when** `stop()` is called, **then** it resolves
  without throwing.
- **Given** a started server, **when** `stop()` is called twice, **then** both calls resolve without
  throwing.
- **Given** `port` set to a port already in use, **when** `start()` is called,
  **then** it rejects, and the rejection is the only failure mode of `start()` (REQ-007).

---

#### REQ-057 — Silence by default

- **Given** a server created with no `logLevel` and started,
  **when** requests are issued, **then** nothing is written to the process's stdout or stderr by
  `createServer`, `start`, request handling, or `stop`.
- **Given** `logLevel: 'error'` or higher, **then** log output is permitted; its format and content
  are not specified and no test may assert on it.

---

#### REQ-058 — Startup cost

- **Given** `examples/petstore.yaml`, **when** `createServer` followed by `start()` is executed,
  **then** both resolve within 5 seconds on an ordinary developer machine.
- No other performance characteristic — per-request latency, throughput, memory — is specified for
  the MVP (§7).

---

## 6. Supported / not supported

This table is normative and bounds the MVP. *Rejected* entries fail `createServer` with
`UNSUPPORTED_CONSTRUCT` and the given construct token (REQ-009, REQ-010). *Ignored* entries load and
serve without error, with the stated behaviour (REQ-012). *Request-time* entries load successfully
and produce the stated HTTP error only when the affected operation is requested.

| Construct | Status | Behaviour |
|---|---|---|
| `$ref`, internal (`#/...`) | **Supported** | Resolved at load time, anywhere OAS 3.0 permits a reference. REQ-005 |
| `$ref`, unresolvable | Rejected (load) | `SPEC_REF_UNRESOLVABLE`. REQ-005 |
| `$ref`, external file or URL | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `externalRef`. Single-file specifications only. REQ-010 |
| `$ref`, circular | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `circularRef`. Generation from a recursive schema has no natural termination. REQ-010 |
| Path parameters | **Supported** | Whole-segment templates, default `simple` style. Validated; failures are `422`. REQ-014, REQ-019 |
| Query parameters | **Supported** | Default `form` style with default `explode`. Primitives, enums, and arrays of primitives. Undeclared parameters ignored. REQ-020 |
| Header parameters | **Supported** | Default `simple` style, case-insensitive names. REQ-021 |
| Cookie parameters | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `cookieParameter`. REQ-010 |
| Non-default parameter `style` / `explode` | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `parameterStyle`. Covers `deepObject`, `pipeDelimited`, `spaceDelimited`, `label`, `matrix`. REQ-010 |
| Parameter `content` instead of `schema` | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `parameterContent`. REQ-010 |
| `requestBody`, JSON media types | **Supported** | Validated when present; `required` honoured. REQ-022 |
| `requestBody`, no JSON media type at all | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `nonJsonRequestBody`. REQ-010 |
| `requestBody`, undocumented request `Content-Type` | Request time | `415` / `UNSUPPORTED_REQUEST_MEDIA_TYPE`. REQ-023 |
| `requestBody.content[mt].encoding` | Ignored | Only relevant to non-JSON bodies, which are rejected at load. |
| `allOf` | **Supported** | Validated and generated. REQ-038 |
| `oneOf` / `anyOf` | **Supported** | Validated; generation picks one branch, deterministically under the effective seed. REQ-038 |
| `discriminator` | Ignored | No mapping resolution; validation and generation proceed from the `oneOf`/`anyOf` branches, so bodies stay schema-valid. REQ-012 |
| `not` | **Supported** | Passed through to the validator and the generator; no special handling. |
| `nullable` | **Supported** | Converted to a JSON Schema type union for validation and generation. |
| `enum` | **Supported** | Enforced in validation; generated values are drawn from the enum. |
| `format` — `int32`, `int64`, `float`, `double`, `date`, `date-time`, `email`, `uuid`, `uri`, `hostname`, `ipv4`, `ipv6`, `password` | **Supported** | Validated via `ajv-formats`; honoured by the generator. REQ-038 |
| `format` — `byte`, `binary` | Ignored | Treated as a plain string; no base64 decoding, no binary payloads. |
| `format` — anything else | Ignored | Annotation only; the remaining schema constraints still apply. REQ-038 |
| `pattern` | **Supported** | Enforced in validation; honoured by the generator. |
| `additionalProperties` (`false` or a schema) | **Supported** | Enforced in validation and respected in generation. REQ-038 |
| Array bounds — `minItems`, `maxItems`, `uniqueItems` | **Supported** | Enforced in validation and respected in generation. REQ-038 |
| Numeric and string bounds — `minimum`, `maximum`, `exclusiveMinimum`/`exclusiveMaximum` (3.0 boolean form), `multipleOf`, `minLength`, `maxLength` | **Supported** | Enforced in validation and respected in generation. |
| `readOnly` | **Supported** | Dropped from `required` for request validation; accepted and ignored if supplied. REQ-025 |
| `writeOnly` | **Supported** | Never present in a generated response body. REQ-025, REQ-039 |
| Root `servers[0].url` with a path component and no template variable | **Supported** | Its path component is the base path and is prefixed to every route. Trailing slashes stripped. REQ-018 |
| Root `servers[0].url` containing a template variable (`{...}`) | Ignored | The entry is ignored in full, `server.variables` defaults are not substituted, and the base path is empty. REQ-018 |
| Root `servers` entries after the first; path-item or operation `servers` | Ignored | Never affect routing. REQ-018 |
| `security` / `securitySchemes` | Ignored | Never enforced; no credential is required or validated. A documented `401`/`403` is reachable with `Prefer: code=401`. REQ-012 |
| `callbacks` | Ignored | Never invoked; a mock server makes no outbound requests. REQ-012 |
| `links` | Ignored | No `Link` header and no link processing. REQ-012 |
| Response `headers` | Ignored | Documented response headers are not emitted. REQ-012, REQ-043 |
| `webhooks` | Rejected (load) | A 3.1-only root field; in a 3.0 document it is an unknown root field → `SPEC_INVALID`. In a 3.1 document the version gate fires first → `UNSUPPORTED_SPEC_VERSION`. REQ-003, REQ-004 |
| Response media types — `application/json` and `*+json` | **Supported** | Selected per REQ-030. |
| Response media types — all others (`text/*`, `application/xml`, `multipart/*`, `application/octet-stream`, …) | Request time | Skipped during selection; if the selected response has content but no JSON media type → `406` / `NO_SUPPORTED_MEDIA_TYPE`. REQ-031 |
| `Accept` request header | Ignored | No content negotiation; the media type is chosen by REQ-030 alone. |
| `deprecated` | **Supported** | Served normally, with a `Deprecation: true` response header. REQ-037 |
| Response code wildcards (`2XX`, `4XX`, …) | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `responseCodeRange`. REQ-010 |
| `default` response | **Supported** | Used only when the operation documents no numeric status; served as `200`. REQ-027 |
| `example` / `examples` with `value` | **Supported** | Precedence per REQ-033; selectable with `Prefer: example=<name>`. REQ-034 |
| `example` **and** `examples` on the same media type | **Supported** (tolerated) | The OpenAPI 3.0 meta-schema forbids this (`ExampleXORExamples`), but the document is **accepted** rather than rejected, and `example` is served. The only meta-schema constraint not enforced. REQ-004, REQ-033 |
| `examples` with `externalValue` | Rejected (load) | `UNSUPPORTED_CONSTRUCT`, token `externalValue`. REQ-010 |
| `xml` object on a schema | Ignored | No XML is ever produced. |
| Vendor extensions (`x-...`) | Ignored | Never affect behaviour. REQ-012 |
| `info`, `tags`, `externalDocs`, `summary`, `description` | Ignored | Documentation only; not served anywhere. |

---

## 7. Out of scope for the MVP

Each line is excluded deliberately; each is a clean follow-up iteration.

- **OpenAPI 3.1.x and Swagger 2.0** — D-001; a second validation branch roughly doubles the QA
  surface.
- **Multi-file specifications** (external `$ref`) — keeps loading to one file and avoids network
  fetches during load.
- **Recursive / circular schemas** — generation has no natural termination without a depth policy,
  which is itself a design decision.
- **Non-JSON request and response bodies** (XML, form encoding, multipart, binary) — a second
  serialisation path with its own generator.
- **Content negotiation on `Accept`** — doubles the response-selection matrix for no MVP benefit;
  `Prefer` already selects deterministically.
- **Security enforcement** (rejecting unauthenticated requests, validating API keys or bearer
  tokens) — a mock that refuses requests is harder to use than one that does not.
- **Emitting documented response headers, `Link` headers and `callbacks`** — no consumer in the MVP.
- **Server URL templating** (`server.variables` substitution to derive a base path) — REQ-018
  ignores a templated `servers[0].url` rather than choosing a default expansion for it.
- **Stateful behaviour** (a `POST` affecting a later `GET`) — excluded by ARCHITECTURE §1.
- **Request/response recording, proxy or passthrough mode** — a different product.
- **CORS headers, TLS, authentication of the mock itself, hot reload of the specification on file
  change** — local single-user tool.
- **A web UI, a health endpoint, a `/openapi.json` endpoint, a root index page** — REQ-016 makes
  every undocumented path a `404`.
- **Latency simulation, error injection, `Prefer: wait`** — a plausible next iteration; ignored
  directives (REQ-035) leave room for it.
- **Performance targets beyond startup time** (REQ-058).

---

## 8. Open questions for the user

**There are none. Every question this document raised has been answered.** The section is kept, and
this statement made explicitly, because "no open questions" is a claim about the document's
readiness that QA and the Developer are entitled to see asserted rather than inferred from an
absent section.

### 8.1 Decisions taken after review

Rows 1–5 are the questions raised in the first draft; row 6 is a conflict between two requirements
that surfaced during implementation. All were put to the user and answered. Each outcome is recorded
here and is already reflected in the requirement it affects; where the two differ, the requirement
is authoritative.

| # | Question | Outcome | Affected |
|---|---|---|---|
| 1 | Should a base path from `servers[0].url` be honoured? | **Changed.** Yes — the path component of the first root-level `servers` entry is prefixed to every route, provided the URL carries no template variable; a templated URL is ignored and routing falls back to the `paths` keys. Rationale: the primary use of a mock is pointing an existing client at it, and that client has the base path compiled in. | REQ-018, REQ-012, §6, §7 |
| 2 | Should circular `$ref` be supported with a generation depth cap? | **Confirmed as specified.** Rejected at load time with `UNSUPPORTED_CONSTRUCT`, token `circularRef`. | REQ-010, §6, §7 |
| 3 | Should `REQUEST_VALIDATION_FAILED` be `422` or `400`? | **Confirmed as specified.** `422`, so that the commonest mock error is separable from a documented `400` by status alone. | REQ-045 |
| 4 | Are the `X-Mock-*` headers acceptable as the disambiguation mechanism? | **Confirmed as specified.** All three — `X-Mock-Source`, `X-Mock-Payload`, `X-Mock-Seed` — stay. | REQ-043, REQ-044, REQ-046, REQ-054 |
| 5 | Should an unsatisfiable `Prefer: code=NNN` error, or fall back silently per RFC 7240? | **Confirmed as specified.** `400` / `NO_RESPONSE_FOR_STATUS`. A silently ignored preference yields a passing test that verified nothing; the departure from the RFC's advisory semantics is deliberate. | REQ-029 |
| 6 | REQ-033 gives a precedence rule for a media type declaring both `example` and `examples`, but the meta-schema's `ExampleXORExamples` constraint makes such a document invalid, which REQ-004 required rejecting. The two could not both hold. | **Tolerance legitimised.** The document is accepted; `ExampleXORExamples` is the one meta-schema constraint not enforced, and REQ-033 governs the payload. Declaring both is a common authoring mistake that other mock tools tolerate; rejecting it would trade a working mock for meta-schema purity. | REQ-004, REQ-033, §6 |

Questions 1 and 6 changed the deliverable; the rest confirmed what was already specified. Question 6
was raised during implementation rather than at review, and is recorded here because this table is
where a reader now looks for how such conflicts were settled. Every affected requirement was
amended in place and keeps its id; no requirement was renumbered and the total is unchanged.

### 8.2 If something here is later found wrong

Per `CLAUDE.md`, a requirement that appears wrong, or a test that appears to contradict one, is
reported to the orchestrator. It is not resolved by editing the other side's artifact, and an
approved requirement changes only with the user's agreement.

---

## 9. Concerns

None of these contradicts an approved decision; they are risks recorded so the orchestrator can
decide whether to accept them.

1. **`X-Mock-Seed` couples the contract to the existence of a seed.** It is the only way I found to
   make REQ-054 (seed scope) testable without asserting generated values, which D-005 forbids.
   Should the data generator ever be replaced by one with no integer seed, this header — and the
   tests that assert on it — would have to change. The alternative was to state the seed-scope
   decision untestably, which would have left it out of the traceability matrix, exactly the failure
   mode `CLAUDE.md` warns about for determinism.
2. **Rejecting circular `$ref` at load time is the most aggressive exclusion in this document.** It
   is the right MVP call, but it will reject specifications users consider ordinary. REQ-009's
   structured `details` at least makes the reason unambiguous. See open question 2.
3. **Ignoring `security` means the mock cannot be used to test an authentication flow.** That is the
   correct trade-off for a mock (a mock that refuses requests is a poor mock), but it should be
   stated in the README so that nobody discovers it during an integration.
4. **`oneOf` / `anyOf` generation is the least predictable supported construct.** Validation is
   sound, but which branch `json-schema-faker` picks is a library behaviour, not a specified one.
   REQ-038 therefore only requires schema conformance, and REQ-052 only requires reproducibility —
   deliberately not "always the first branch". If the Developer finds the library non-reproducible
   for these keywords, that is a defect against REQ-052 and must be reported, not worked around by
   weakening the test.
5. **The base path widens the routing surface** (REQ-018, decided after review). Every routing
   requirement now has two shapes — with a prefix and without — and the rules for a templated,
   relative, trailing-slashed or unparseable `servers[0].url` are all load-time branches that can
   only be seen by starting a server and issuing a request. REQ-018 therefore carries more
   acceptance criteria than any other requirement in this document, and that is deliberate: this is
   the area where a wrong guess is invisible until a real client is pointed at the mock.

*(A fifth concern in the first draft — that REQ-043's reserved `X-Mock-` prefix depended on
documented response headers not being emitted — has been resolved by restating REQ-043 so the two
are independent, and is therefore dropped.)*

---

## 10. Traceability summary

| Area | Requirements |
|---|---|
| Specification loading | REQ-001 .. REQ-008 |
| Capability checking | REQ-009 .. REQ-012 |
| Routing | REQ-013 .. REQ-018 |
| Request validation | REQ-019 .. REQ-026 |
| Response selection | REQ-027 .. REQ-037 |
| Data generation | REQ-038 .. REQ-041 |
| Error model and disambiguation | REQ-042 .. REQ-046 |
| CLI | REQ-047 .. REQ-051 |
| Non-functional | REQ-052 .. REQ-058 |

**58 requirements.** Ids are permanent and are never renumbered.
