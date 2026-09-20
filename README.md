# local-mock-server

Serve dynamic HTTP responses from a local **OpenAPI 3.0.x** specification, so client integrations can
be developed and tested without a real backend.

Point it at a spec, get a working API. Responses are generated from the declared schemas, examples in
the document are served verbatim, requests are validated against the specification, and the same seed
always produces the same response.

```bash
npm install
npm run dev -- --spec examples/petstore.yaml --port 4010 --seed 42
```

```
Mock server listening on http://127.0.0.1:4010
```

## What it does

```bash
# Generated from the response schema
curl -s localhost:4010/pets
# [{"id":5325863305791668000,"name":"a35SVnSrarYaG10ShMndNsczPP5HrHDXzS6","status":"available"}, …]

# An example declared in the spec is served verbatim
curl -s localhost:4010/pets/1
# {"id":1,"name":"Rex","status":"available","tags":["dog","good-boy"]}

# Ask for a different documented response
curl -s -H 'Prefer: code=404' localhost:4010/pets/1
# {"code":"NOT_FOUND","message":"Pet not found."}

# Requests are validated against the spec
curl -s 'localhost:4010/pets?limit=999'
# {"code":"REQUEST_VALIDATION_FAILED","message":"The request does not match the specification: 1 violation(s).", …}

# An undocumented route is the mock's own error, not a mocked one
curl -s localhost:4010/nosuchpath
# {"code":"ROUTE_NOT_FOUND","message":"No operation is documented for GET /nosuchpath."}
```

## Options

```
mock-server --spec <path> [options]

  -s, --spec <path>      Local OpenAPI 3.0.x document, YAML or JSON. Required.
  -p, --port <number>    Port to bind (default 4010; 0 picks a free port).
      --host <address>   Interface to bind (default 127.0.0.1).
      --seed <number>    Seed for generated data (default 1).
      --log-level <lvl>  silent | error | warn | info | debug (default info).
  -h, --help             Show usage.
```

The format is detected from the file's contents, not its extension.

## Try it in Postman

Import [examples/local-mock-server.postman_collection.json](examples/local-mock-server.postman_collection.json).
It has three folders, each carrying assertions, so **Run collection** gives pass/fail rather than
output to squint at:

| Folder | What it demonstrates |
|---|---|
| A | Two responses that are both `404` and mean different things |
| B | Requests validated against the specification |
| C | Determinism, and why two different requests draw independently |

Folder C compares responses to each other, so run it top to bottom. The collection expects the
server started with `--seed 42`; the interesting part of each response is the **Headers** tab.

## Steering the mock

Control is by the `Prefer` request header only, so it can never collide with a query parameter the
specification declares.

| Header | Effect |
|---|---|
| `Prefer: code=404` | Serve the operation's documented `404` response instead of the default |
| `Prefer: example=notFound` | Serve the named entry from the media type's `examples` map |

Without a `Prefer` header the lowest documented `2xx` is served. Asking for a response the operation
does not document is an error rather than a silent fallback — a preference that is quietly ignored
produces a passing test that verified nothing.

## Telling a mocked response from a mock error

A specification can document its own `404`, so the mock never leaves the two ambiguous. Every
response carries `X-Mock-Source`, and any of three independent signals settles it:

| | Documented response | Mock's own error |
|---|---|---|
| `X-Mock-Source` | `specification` | `mock` |
| `Content-Type` | as declared in the spec | `application/problem+json` |
| Body | as declared in the spec | `{ "code": …, "message": … }` |

Two further headers describe how a served payload was produced: `X-Mock-Payload` is `example`,
`generated` or `none`, and `X-Mock-Seed` carries the effective seed when the payload was generated.

## Determinism

An equal seed and an equal request always produce an equal response body, within a run and across
processes. The effective seed is derived from the configured seed together with the identity of the
request, so different requests to the same operation draw independently — do not carry a value seen at
one path over to another.

Generated values are re-validated against the schema they came from before being served; a value that
does not conform fails the request rather than being returned.

## Supported and not supported

The full table is in [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) §6 — 49 rows, one per construct.
The headline:

**Supported.** Local `$ref` resolution, path/query/header parameters, request bodies, `allOf`,
`oneOf`, `anyOf`, `nullable`, `enum`, common `format` values, schema bounds, `readOnly`/`writeOnly`,
multiple documented status codes, examples at every precedence level, and a base path taken from
`servers[0].url`.

**Rejected at load time**, with an error naming the construct: external `$ref`, circular `$ref`,
cookie parameters, parameter `style`/`explode`, parameter `content`, response code ranges,
`externalValue`, and non-JSON request bodies.

**Accepted but ignored**, because ignoring them cannot produce a wrong response: `discriminator`,
`security`, `callbacks`, `links`, declared response headers, `xml`, unknown `format` values, and
vendor extensions. Note in particular that **security is not enforced** — a mock that refuses
unauthenticated requests is a poor mock, so authentication flows cannot be tested against this tool.

Out of scope for the MVP, each with a reason: OpenAPI 3.1.x and Swagger 2.0, multi-file
specifications, non-JSON bodies, `Accept` negotiation, stateful behaviour, proxy or record modes,
CORS, TLS and hot reload.

## How this was built

Requirements, the acceptance suite, and the implementation were produced by separate AI agents with
isolated context, handing work to each other through files in this repository. The tests were written
from the approved requirements before any implementation existed, and the implementation was never
allowed to modify them.

| Document | Contents |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 58 numbered requirements with acceptance criteria |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Pipeline, public contract, technology choices |
| [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | Test strategy and the traceability matrix |
| [docs/ACCEPTANCE-REPORT.md](docs/ACCEPTANCE-REPORT.md) | Verification results and what the process caught |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log with rationale and rejected alternatives |
| [CLAUDE.md](CLAUDE.md) | Working agreement: file ownership and invariants |

## Development

```bash
npm run typecheck        # tsc --noEmit
npm run test:unit        # 100 unit tests
npm run test:acceptance  # 269 black-box acceptance tests over real HTTP
npm test                 # full regression: 369 tests
```

## License

MIT
