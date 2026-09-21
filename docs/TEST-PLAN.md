# Test plan — local-mock-server acceptance suite

Status: **written test-first** (Stage 2). Owner: QA Engineer.
Source of truth: `docs/REQUIREMENTS.md` (approved, frozen) and `docs/ARCHITECTURE.md` §3–§4.
Scope of this document: `qa/fixtures/**`, `qa/helpers/**`, `qa/acceptance/**`.

At the time of writing, no implementation exists: `src/` is a bootstrap skeleton that answers
`501 NOT_IMPLEMENTED` to every request. The suite was written against the requirements alone and
run to confirm that each test fails for a reason the implementation will have to fix.

**Second round (2026-09-21).** Fifteen tests and twelve fixtures were added after an external
review of the finished project, not while writing the original suite: two tests pin the boundary of
REQ-004's tolerated meta-schema exception — one of which is **red on purpose**, ahead of the fix —
and thirteen cover the reachability scoping the REQ-009/REQ-010 amendment made explicit. §6.8
records the round; §8 records the one expected failure.

---

## 1. Strategy

### 1.1 Black box, over real HTTP

Every test creates a server through the public contract only:

```ts
const server = await createServer({ specPath, port: 0, seed });
const { url } = await server.start();
const response = await fetch(`${url}/pets`);
await server.stop();
```

`createServer` is the single symbol the suite imports from `src/` — verifiable with
`grep -rn "src/" qa/ --include=*.ts`, which returns exactly one line, in `qa/helpers/server.ts`.
Nothing imports Fastify, nothing calls `inject()`, and there is no supertest. The HTTP framework
can be replaced without touching a test.

Every server is registered through `useServer(...)` or started inside a `try/finally`, so `stop()`
runs in `afterAll` even when a test failed or the startup itself failed. Ports are ephemeral
(`port: 0`) except where a requirement names a port.

### 1.2 Schema conformance, not generated values

A response body that the server generated is validated against the schema **taken from the
fixture**, never against a transcript of what the generator happened to produce:

1. `@apidevtools/swagger-parser` dereferences the fixture;
2. the response's OAS 3.0 Schema Object is converted to JSON Schema by
   `@openapi-contrib/openapi-schema-to-json-schema`;
3. `ajv` + `ajv-formats` compiles and validates it.

Exact values are asserted only where the specification prescribes them: example passthrough
(REQ-033, REQ-034, REQ-046), a schema whose `enum` has a single member, and the self-naming
`example` markers that several fixtures use to identify *which* documented response answered.

Determinism (REQ-052) and seed scope (REQ-054) are observed through the `X-Mock-Seed` and
`X-Mock-Payload` headers (REQ-044) and by comparing two responses to each other. No test hard-codes
a seeded value.

### 1.3 Fixtures are small and single-purpose

65 fixtures in `qa/fixtures/`, one concern each — a valid minimal API, one rejected construct per
file, one `servers[0].url` shape per file, one payload-precedence case per operation. A failure
therefore names its own cause.

Where a requirement turns on *where* a construct sits rather than on the construct itself, the
fixtures are written as **minimal pairs** that differ by one key or one line, so the difference in
outcome has only one possible cause: `tolerated-example-xor-examples-scope.yaml` versus
`invalid-parameter-example-xor-examples.yaml` (one `example:` key on a parameter, REQ-004), and
`reachability-baseline.yaml` → `reachability-unreferenced-cookie-parameter.yaml` →
`reachability-referenced-cookie-parameter.yaml` (a `components` member, then one `$ref` to it,
REQ-009). `examples/petstore.yaml` is used directly wherever a requirement is
written against it (REQ-002, REQ-013..REQ-017, REQ-019..REQ-024, REQ-033, REQ-034, REQ-046,
REQ-052..REQ-058), and `qa/fixtures/petstore-as-json.txt` is its byte-equivalent JSON form saved
with a non-JSON extension, which is what makes REQ-002 a real test of content sniffing.

Mechanical variants — the `openapi` version matrix, an unparseable file, a directory as `specPath` —
are written to a temporary directory by `qa/helpers/spec-file.ts` rather than checked in as a dozen
files differing in one line. They are removed in `afterAll`.

### 1.4 Test naming and traceability

Every test name begins with the requirement id it covers, e.g.
`REQ-012: rejects a request missing a required query parameter`. The matrix in §5 is derived from
the test names by the runner's JSON reporter, not maintained by hand, so it cannot drift.

---

## 2. Techniques applied

| Technique | Where |
|---|---|
| **Equivalence partitioning** | Accepted vs rejected `openapi` versions (REQ-003); JSON vs non-JSON media types (REQ-030, REQ-031); declared vs undeclared query parameters (REQ-020); documented vs undocumented request `Content-Type` (REQ-023); parseable-but-invalid vs unparseable body (REQ-024). |
| **Boundary value analysis** | `port` at `-1`, `1.5`, `65536` and `0` (REQ-006); `limit` at `0` and `20` against `minimum: 1, maximum: 100` (REQ-020); array `maxItems` at 2 and 4 against `maxItems: 3` (REQ-020); `Prefer: code` at `40`, `099`, `1000` against "exactly three digits in 100..599" (REQ-035); `X-Mock-Seed` at the ends of `0..4294967295` (REQ-044). |
| **Decision-table coverage** | The request-time error table of REQ-045 is driven directly: one row, one trigger, one test (10 tests). The payload-precedence ladder of REQ-033 is covered level by level. |
| **State-transition coverage** | The lifecycle of REQ-056: created → started → stopped, plus stop-without-start and stop-twice. |
| **Ordering / precedence** | Status before media type before payload (REQ-027/030/033); `code` applied before `example` (REQ-034); version gate before validation before capability check (REQ-003); validation before `Prefer` parsing (REQ-035); document order for `examples`, for JSON media types, for `Allow`, and for `UNSUPPORTED_CONSTRUCT` details (REQ-011). |
| **Negative-path coverage** | Every error code in REQ-045 has at least one test that provokes it. Assertions are on `code` and, where the requirement specifies them, on `details[].location` / `details[].name` — never on message wording. |
| **Fail-fast verification** | REQ-007 reserves a real free port, asserts `createServer` rejects, asserts the port still refuses connections, and then asserts a valid specification can still bind that same port. |
| **Cross-process verification** | REQ-052 runs one request in a separate `node`/`tsx` process (`qa/helpers/subprocess-request.ts`) and compares the body byte for byte, because in-process determinism does not imply it. |
| **Concurrency** | REQ-053 runs two servers with different seeds interleaved and ten concurrent identical requests. |
| **Vacuity guards** | Criteria phrased as an absence ("carries no `Deprecation` header", "`password` is absent", "the two bodies are identical") also assert the precondition — the status and, where relevant, `X-Mock-Payload` — so they cannot pass against a server that answers everything the same way. This was added after the first run showed 22 such tests passing against the 501 skeleton. |

---

## 3. Sizing

The requirements carried 201 acceptance criteria after the Stage-2 amendments to REQ-044, REQ-051,
REQ-052, REQ-054 and — during implementation — REQ-004 and REQ-033, and carry ten more after the
REQ-009/REQ-010 amendment of 2026-09-21. (That amendment counts the totals as 202 → 212; this plan
counted 201 before it. The two hand counts differ by one criterion, and nothing in the suite depends
on either number.) The suite has **284 tests**.
The default is one test per criterion. The excess is entirely equivalence-class expansion of single criteria, never
combinatorial exploration of several criteria together:

| Criterion expanded | Tests | Why |
|---|---|---|
| REQ-003 "a document with `openapi: 3.0.0`, `3.0.1`, `3.0.2`, `3.0.3` or `3.0.4` resolves" | 5 | Five distinct version strings in one sentence; a single test would hide which patch level regressed. |
| REQ-004 "for example an operation with no `responses`, a `paths` key not beginning with `/`, or an unknown root field" | 3 | Three structurally different violations of the same rule. |
| REQ-010 "each criterion below is a separate specification fixture and a separate test" | 8 | Stated by the requirement itself. |
| REQ-010 "the same holds for the four other tokens that are scoped by reachability" | 5 | One criterion naming five tokens; a single fixture carrying all five would not say which check is unscoped. |
| REQ-010 "and, by REQ-009, not for `externalRef` or `circularRef`" | 2 | The two whole-document exceptions, one fixture each. |
| REQ-004 "the `ExampleXORExamples` constraint **on the Media Type Object**" | 2 | The relaxation is scoped to one object type; the boundary needs a case on each side of it. |
| REQ-035 "`code=abc`, `code=40`, `code=1000`, `code=` or `code=099`" | 5 | Five distinct malformed-value classes. |
| REQ-035 parsing rules stated as prose (case-insensitive names, quote stripping, multi-value concatenation) | 3 | Normative rules that would otherwise be untested. |
| REQ-038 "a schema using `allOf`, `oneOf` or `anyOf`" | 3 | Three keywords with three different generator paths; `oneOf`/`anyOf` are flagged in REQUIREMENTS §9.4 as the least predictable. |
| REQ-045 "given each row of the request-time table" | 10 | One row is one criterion; this block is the spine of the error-code traceability. |
| REQ-006 `port` out of range | 3 | Below, above, and non-integer. |
| REQ-018 rules 2, 3 and 6 of the base-path algorithm | 3 extra | The highest-risk area in the document per REQUIREMENTS §9.5; rules 2 and 6 are normative but carry no Given/When/Then of their own. |

Test files mirror requirement groups, so a failing group is diagnosable from the file name alone:
`spec-loading`, `capabilities`, `routing`, `base-path`, `request-validation`, `response-selection`,
`payload-and-prefer`, `data-generation`, `error-model`, `cli`, `non-functional`.

---

## 4. Risk areas

1. **Base path derivation (REQ-018) — highest.** Flagged by the Business Analyst (REQUIREMENTS §9.5)
   and carrying more acceptance criteria than any other requirement. A wrong guess here is invisible
   until a real client is pointed at the mock. Covered by 15 tests over 9 dedicated fixtures, each
   differing only in its `servers` block — including rule 6, whose fixture declares the string
   `http://[`: valid against the Server Object schema, unparseable by `new URL` either as an
   absolute URL or against a base.
2. **`Prefer` parsing (REQ-035).** A control channel with its own grammar, its own error code, and a
   specified ordering relative to request validation. 14 tests, including the whitespace, quoting,
   case and duplicate-directive rules that are stated as prose rather than as Given/When/Then.
3. **Documented error vs mock error (REQ-046).** The disambiguation the architecture left open. Three
   independent signals, each asserted separately, plus the adversarial case where the specification
   itself documents `application/problem+json`.
4. **Seed scope (REQ-054).** The only requirement whose observable surface is a header invented for
   the purpose (REQUIREMENTS §9.1). If `X-Mock-Seed` is ever dropped, five tests must change. It is
   also the requirement with an internal conflict — see §6.1.
5. **`oneOf` / `anyOf` generation (REQ-038, REQUIREMENTS §9.4).** Branch selection is library
   behaviour, not specified behaviour. The suite therefore asserts schema conformance only, and
   reproducibility separately under REQ-052. If the generator turns out to be non-reproducible for
   these keywords, that is a REQ-052 defect to report, not a test to weaken.
6. **Capability detection completeness (REQ-009..REQ-011).** Eight tokens, each with its own fixture,
   plus one fixture carrying three distinct constructs to pin both the "report them all at once" rule
   and the document-order rule.
7. **Port contention across parallel workers.** Vitest runs spec files in parallel, and three
   requirements name the default port 4010 (REQ-006, REQ-047, REQ-050). Those tests take a
   cross-process lock (`withDefaultPortLock` in `qa/helpers/net.ts`); everything else reserves a
   free port dynamically. This is test-infrastructure risk, not product risk, but it would show up
   as intermittent failures that look like product defects.

---

## 5. Traceability matrix

Derived from test names. 284 tests, 58 of 58 requirements covered, **no requirement with zero tests**.

| Requirement | Tests | Spec file |
|---|---|---|
| REQ-001 | 4 | `spec-loading.spec.ts` |
| REQ-002 | 2 | `spec-loading.spec.ts` |
| REQ-003 | 11 | `spec-loading.spec.ts` |
| REQ-004 | 8 | `spec-loading.spec.ts` |
| REQ-005 | 3 | `spec-loading.spec.ts` |
| REQ-006 | 9 | `spec-loading.spec.ts` |
| REQ-007 | 3 | `spec-loading.spec.ts` |
| REQ-008 | 5 | `spec-loading.spec.ts` |
| REQ-009 | 8 | `capabilities.spec.ts` |
| REQ-010 | 16 | `capabilities.spec.ts` |
| REQ-011 | 2 | `capabilities.spec.ts` |
| REQ-012 | 7 | `capabilities.spec.ts` |
| REQ-013 | 4 | `routing.spec.ts` |
| REQ-014 | 5 | `routing.spec.ts` |
| REQ-015 | 3 | `routing.spec.ts` |
| REQ-016 | 4 | `routing.spec.ts` |
| REQ-017 | 5 | `routing.spec.ts` |
| REQ-018 | 15 | `base-path.spec.ts` |
| REQ-019 | 4 | `request-validation.spec.ts` |
| REQ-020 | 11 | `request-validation.spec.ts` |
| REQ-021 | 4 | `request-validation.spec.ts` |
| REQ-022 | 6 | `request-validation.spec.ts` |
| REQ-023 | 3 | `request-validation.spec.ts` |
| REQ-024 | 2 | `request-validation.spec.ts` |
| REQ-025 | 3 | `request-validation.spec.ts` |
| REQ-026 | 2 | `request-validation.spec.ts` |
| REQ-027 | 5 | `response-selection.spec.ts` |
| REQ-028 | 3 | `response-selection.spec.ts` |
| REQ-029 | 2 | `response-selection.spec.ts` |
| REQ-030 | 4 | `response-selection.spec.ts` |
| REQ-031 | 2 | `response-selection.spec.ts` |
| REQ-032 | 2 | `response-selection.spec.ts` |
| REQ-033 | 7 | `payload-and-prefer.spec.ts` |
| REQ-034 | 5 | `payload-and-prefer.spec.ts` |
| REQ-035 | 14 | `payload-and-prefer.spec.ts` |
| REQ-036 | 3 | `payload-and-prefer.spec.ts` |
| REQ-037 | 3 | `payload-and-prefer.spec.ts` |
| REQ-038 | 8 | `data-generation.spec.ts` |
| REQ-039 | 2 | `data-generation.spec.ts` |
| REQ-040 | 2 | `data-generation.spec.ts` |
| REQ-041 | 3 | `data-generation.spec.ts` |
| REQ-042 | 3 | `error-model.spec.ts` |
| REQ-043 | 3 | `error-model.spec.ts` |
| REQ-044 | 5 | `error-model.spec.ts` |
| REQ-045 | 10 | `error-model.spec.ts` |
| REQ-046 | 4 | `error-model.spec.ts` |
| REQ-047 | 4 | `cli.spec.ts` |
| REQ-048 | 2 | `cli.spec.ts` |
| REQ-049 | 4 | `cli.spec.ts` |
| REQ-050 | 4 | `cli.spec.ts` |
| REQ-051 | 4 | `cli.spec.ts` |
| REQ-052 | 7 | `non-functional.spec.ts` |
| REQ-053 | 2 | `non-functional.spec.ts` |
| REQ-054 | 6 | `non-functional.spec.ts` |
| REQ-055 | 4 | `non-functional.spec.ts` |
| REQ-056 | 6 | `non-functional.spec.ts` |
| REQ-057 | 1 | `non-functional.spec.ts` |
| REQ-058 | 1 | `non-functional.spec.ts` |

To regenerate:

```bash
npx vitest run --project acceptance --reporter=json --outputFile=/tmp/acceptance.json
```

and group `assertionResults[].title` by its first seven characters.

---

## 6. Requirements review — items raised, and how they were closed

Five items were raised against `docs/REQUIREMENTS.md` — four by QA in the first draft of this plan,
one by the Developer during implementation. Four were genuine gaps in the requirements and have been
amended; one was a mistake in this suite. Nothing in `docs/REQUIREMENTS.md` was edited by QA.

§6.1–§6.5 are the **first round**, raised while writing the suite. §6.8 is a **second round**,
raised after the project was declared complete, by an independent external review rather than by
this suite, and worked the other way round: it started from observed behaviour and asked what the
requirements actually said about it. §6.6 and §6.7 are neither — they record two criteria this
suite deliberately does not assert.

### 6.1 REQ-054 and REQ-052 named an operation that could not satisfy their criteria — **amended**

REQ-054's criteria were written against `GET /pets/1` and `GET /pets/2` on the default
specification and required `X-Mock-Payload: generated`. But `examples/petstore.yaml`'s
`GET /pets/{petId}` declares an `examples` map, so by REQ-033 its payload is the `rex` example and
by REQ-044 it carries no `X-Mock-Seed`.

**Resolved.** Both requirements now define a **generating operation** — a selected response with a
JSON `content` schema and no `example`, no `examples` and no `schema.example` — in two shapes: G1
at a templated path, G2 with at least two optional query parameters. REQ-052's criteria went from
five to seven: the old first criterion split into a body-identity criterion valid for any operation
and a seed-identity criterion for a generating operation, and a new criterion was added in the
opposite direction — for an example-backed payload, `seed: 42` and `seed: 43` must produce
byte-identical bodies.

The suite follows the amended text. `qa/fixtures/generating-operations.yaml` supplies G1
(`GET /things/{id}`) and G2 (`GET /things`), which REQ-054 explicitly asks QA to provide; the
criteria written against petstore's `GET /pets` (G2) and `GET /pets/1` (example-backed) use
`examples/petstore.yaml` directly, as written. The earlier `seed-scope.yaml` workaround fixture was
removed.

### 6.2 REQ-018 rule 6 — **this suite was wrong, not the requirement**

The first draft of this plan reported rule 6 as untestable, on the grounds that no string could both
pass OpenAPI validation and be rejected by `new URL`. **That was incorrect.** `http://[` is a
plain string, so the Server Object schema is satisfied and REQ-004 does not fire, and both
`new URL("http://[")` and `new URL("http://[", base)` throw `ERR_INVALID_URL`. `http://a b`,
`http://%` and `http://exa mple.com/v1` behave identically; all four were verified on this project.

This was a gap in the suite's coverage, not a defect in the requirements. Rule 6 is now covered by
`qa/fixtures/servers-unparseable-url.yaml` and one test asserting all three things the rule states:
`createServer` resolves (it is explicitly not a load-time error), the base path is empty, and the
`paths` keys are served verbatim.

### 6.3 REQ-044 did not say what `X-Mock-Payload` is for `schema.example` — **amended**

REQ-044 now carries a table mapping all four REQ-033 precedence levels plus the no-content case onto
`X-Mock-Payload` and the presence of `X-Mock-Seed`. All three example levels yield `example` with
the seed absent; only level 4 yields `generated` with the seed present. Level 3 is covered by a
REQ-044 test of its own, and the REQ-033 precedence test now asserts the headers as well as the body.

### 6.4 REQ-051's "exactly one line on stdout" conflicted with REQ-049's default of `info` — **amended**

REQ-051 is now two startup criteria: at `--log-level silent`, exactly one stdout line containing the
bound URL; at any other level, including the CLI default `info`, stdout contains such a line and
further logger lines are permitted, with nothing asserted about their number, order or content.
REQ-049 is unchanged. Both criteria have a test.

### 6.5 REQ-033's precedence rule governed a document REQ-004 rejected — **amended**

Raised by the Developer during implementation, not by QA. REQ-033 level 1 beats level 2, but a media
type declaring both `example` and `examples` violates the OpenAPI 3.0 meta-schema's
`ExampleXORExamples` constraint, which REQ-004 required rejecting — so the precedence rule could
never fire.

**Resolved.** REQ-004 now relaxes that one constraint and no other: such a document loads, and
REQ-033 decides the payload. Two criteria were added and both have a test —
`REQ-004: tolerates example and examples on the same media type and serves the REQ-033 payload`
(its own fixture, `tolerated-example-xor-examples.yaml`, carrying that single violation and nothing
else, so a load failure could not be attributed elsewhere) and
`REQ-033: Prefer: example=<name> overrides the precedence order on that same operation`. The
existing precedence test also now asserts `X-Mock-Payload: example`, which the amended criterion
adds.

Verified independently of the suite that the relaxation is surgical: a document with no
`responses`, a `paths` key not beginning with `/`, an unknown root field, and two path templates
differing only in variable names all still reject with `SPEC_INVALID`.

### 6.6 REQ-008 and the load-time HTTP status

REQ-008 states that the HTTP `status` of a load-time `MockError` "is not part of the contract; no
requirement or test may depend on it". No test asserts it. Noted here only so that its absence from
the matrix is deliberate rather than an omission.

### 6.7 REQ-057's second criterion is not testable by construction

> **Given** `logLevel: 'error'` or higher, **then** log output is permitted; its format and content
> are not specified and **no test may assert on it.**

REQ-057 therefore has one test, not two.

### 6.8 Second round: two findings from an independent external review — **one defect, one amendment**

Raised by a Codex-based reviewer working from `docs/REQUIREMENTS.md` against the finished project,
and confirmed by the orchestrator before it reached QA. Unlike §6.1–§6.5, neither finding was
visible from the requirements alone: both are places where the suite had tested a rule in the
position it was written in and not in the positions it was *not* written in. The lesson carried
forward is in §1.3 — where a rule is scoped to a location, test the other side of that boundary.

**Finding 1 — REQ-004's tolerance is wider in the implementation than in the requirement. Defect.**
REQ-004 relaxes `ExampleXORExamples` on the **Media Type Object** and says "no other meta-schema
constraint is relaxed". The same constraint applies to the Parameter Object, where it is not
relaxed — but a document whose *parameter* declares both `example` and `examples` currently loads
and is served. Two tests were added, a minimal pair that differs by one key:

- `REQ-004: rejects example and examples on a parameter object with SPEC_INVALID`
  (`invalid-parameter-example-xor-examples.yaml`) — **currently failing on its assertion**, written
  before the fix as the project's test-first discipline requires. It is the only red test in the
  suite.
- `REQ-004: the tolerance covers the media type object only, so a parameter with examples alone
  loads` (`tolerated-example-xor-examples-scope.yaml`) — the positive control, green. Both fixtures
  carry the tolerated combination on the media type object, so the pair isolates *where* the second
  copy sits as the only difference between loading and rejecting.

The pre-existing `REQ-004: tolerates example and examples on the same media type …` stays as it
was, on its own single-violation fixture. QA did not touch `src/`; the fix is the Developer's.

**Finding 2 — REQ-009/REQ-010 did not say that capability checking is scoped to `paths`.
Requirement clarified, behaviour unchanged.** A rejected construct in an unreferenced `components`
member loads; the same construct referenced from an operation is rejected. The amendment of
2026-09-21 (REQUIREMENTS §8.1 row 7) states the rule and names `externalRef` and `circularRef` as
whole-document exceptions. Thirteen tests were added for the new criteria over ten fixtures:
five under REQ-009 (unreferenced load; served identically to the same document with the component
deleted; reached through `$ref` rejects; one reference out of several operations is enough; the
inline control) and eight under REQ-010 (the `$ref`-reached pointer and token; the five
reachability-scoped tokens unreferenced; the two `$ref`-graph tokens still rejected unreferenced).
All thirteen passed on their first run against the shipped implementation, which is the expected
outcome for a clarification of shipped behaviour — had one failed it would have been a new defect,
not a test to soften.

**One wording point is left open, and the suite does not resolve it.** REQ-010 says the reported
`pointer` "locates the parameter as the operation reaches it". That reads equally well as the
operation's parameter slot (`#/paths/~1pets/get/parameters/0`) or as the component's own location
(`#/components/parameters/Session`). The test asserts what both readings require — a pointer
beginning `#/` that names a parameter — rather than choosing one. If the Business Analyst wants the
stricter reading, one word settles it and the assertion can be tightened.

## 7. Known limitations

1. **The body validator shares libraries with the implementation.** Response bodies are validated
   with the same AJV, the same `ajv-formats` and the same
   `@openapi-contrib/openapi-schema-to-json-schema` converter that `docs/ARCHITECTURE.md` §7
   prescribes for the server. These are shared third-party libraries, not the Developer's code, so
   this does not couple the suite to the implementation — but **a bug in the converter would be
   shared by both sides and would not be caught**: a schema the converter mistranslates would be
   generated against and validated against the same wrong JSON Schema, and the test would pass.
   This was accepted deliberately; writing an independent OAS-3.0-Schema validator costs more than
   the risk it removes. Mitigation, partial: where a requirement states a bound in words (REQ-038's
   enum membership, string lengths, minimums and `maxItems`), the test asserts that bound directly
   as well as through the schema.

2. **`SIGINT` cannot be delivered to a child process on Windows.** Node maps
   `child.kill('SIGINT')` onto `TerminateProcess`, so the CLI's own handler never runs and the exit
   code is not the CLI's. REQ-051's shutdown test asserts the port release on every platform and the
   exit code only on POSIX. On Windows that test consequently proves less than it does on CI Linux;
   it should be treated as fully meaningful only there.

3. **REQ-055's "no file is created or modified anywhere on disk" is scoped to the project tree.**
   The test snapshots every file under the repository root (excluding `node_modules`, `.git`,
   `dist`, `coverage`) by modification time. A write outside the project tree would not be caught.

4. **REQ-058's 5-second budget is machine-dependent.** It is asserted as written, but on a loaded CI
   runner it is the most plausible source of a flake in the whole suite.

5. **REQ-011's document order relies on one fixture.** `unsupported-three.yaml` places its three
   constructs under `/a`, `/b`, `/c`. If an implementation walked the document in a different order
   that happened to agree for this shape, the test would not notice. A second fixture with a
   different nesting would close this; it was judged not worth the extra file.

6. **No test covers request or response bodies larger than a few kilobytes, nor any performance
   characteristic beyond startup time.** REQUIREMENTS §7 excludes both.

7. **The Header Object side of `ExampleXORExamples` is untested.** OpenAPI 3.0 applies that
   constraint to three objects: Media Type, Parameter and Header. §6.8 adds the Parameter Object
   case; the Header Object case — a `responses[*].headers[*]` declaring both `example` and
   `examples` — has no fixture. It was left out on purpose so that the run has exactly the one
   expected failure, and because REQ-012 ignores documented response headers entirely, so the
   requirements do not say whether such a document should be refused for a header the server never
   emits. Worth a decision from the Business Analyst rather than a guess from QA.

8. **`Prefer` header field folding is tested through a single header.** REQ-035 says all `Prefer`
   field values are concatenated with `,` before parsing. `fetch` does not let a test send two
   separate `Prefer` header fields, so the concatenation rule is exercised by sending one field
   containing a comma. The multi-field case is untested.

---

## 8. Running the suite

```bash
npm run test:acceptance     # the acceptance project only
npm test                    # unit + acceptance
```

**Against the implementation: 284 tests, 283 passing, 1 failing.**

The one failure is deliberate and is the current state of the project, not a flake:

```
REQ-004: rejects example and examples on a parameter object with SPEC_INVALID
  AssertionError: createServer resolved for specPath ".../invalid-parameter-example-xor-examples.yaml";
  expected it to reject with a MockError.
```

It is the red test of §6.8, Finding 1, written ahead of the fix. It fails on an assertion — the
helper stops the wrongly-created server before failing, so no port leaks into the rest of the run —
and it will go green when the loader scopes its `ExampleXORExamples` relaxation to Media Type
Objects. **Any other failure, or this one passing while
`REQ-004: tolerates example and examples on the same media type …` fails, means something else
broke.**

**Against the bootstrap skeleton**, which is how this suite was written and first run, the expected
result was 267 tests with 240 failing on assertions about status, headers, body or error code and 27
passing — never on TypeScript errors, bad imports, timeouts, hanging servers or connection refusals.
The 27 were not vacuous: they were criteria the skeleton already satisfied — the lifecycle contract
(REQ-056, 6 tests), silence by default (REQ-057), startup cost (REQ-058), `createServer` resolving
for a valid 3.0.x document (REQ-003 ×5, REQ-004, REQ-006 ×1), and the CLI's argument handling, usage
output and startup line (REQ-047 ×4, REQ-048 ×2, REQ-049 ×2, REQ-050 ×1, REQ-051 ×3). That baseline
is recorded because a suite that had passed against a skeleton would have proved nothing.
