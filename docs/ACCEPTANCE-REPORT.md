# Acceptance report

Owner: Orchestrator. Produced at the close of the MVP, from the state committed on `main`.

## Verdict

**Accepted.** All 58 requirements are implemented and covered by the independent acceptance suite.
Full regression is green: **369 tests pass** (269 acceptance, 100 unit), `tsc --noEmit` is clean, and
the result reproduced across three separate runs.

## How this was verified

Every figure below was measured by the orchestrator against the committed tree. Agent reports were
treated as claims to check, not as evidence — two of them did not survive checking, and both are
recorded in the process notes at the end.

| Check | Method | Result |
|---|---|---|
| Suite independence | `git diff --name-only <qa-sha>..HEAD -- qa/` after implementation | empty |
| Suite not weakened | `grep` for `.skip`, `.only`, `.todo` across `qa/` and `tests/` | none found |
| Type safety | `grep` for `any`, `@ts-expect-error`, `@ts-ignore`; `tsconfig.json` diff | none; unchanged |
| Framework decoupling | `grep` for `fastify`, `inject(` in `qa/` | none |
| Import boundary | imports from `src/` across the whole suite | one: `createServer` |
| Coverage | requirement ids extracted from runner output, joined against `REQUIREMENTS.md` | 58/58, none at zero |
| Regression | `npm test`, three separate runs | 369 passed each time |
| End to end | real CLI against `examples/petstore.yaml`, curl-equivalent requests | behaves as specified |
| Meta-schema relaxation is surgical | four invalid fixtures loaded directly through `createServer` | all still rejected |

The last row is the one worth keeping. The tolerated `example`/`examples` combination (D-006) is
implemented by validating a sanitised copy of the document. Had that been implemented by disabling
meta-schema validation instead, the new tests would still have passed while REQ-004's main behaviour
was silently broken — so it was checked directly rather than inferred from a green suite.

## Traceability matrix

Every acceptance test name begins with the requirement id it covers, which is what makes this table
derivable rather than hand-maintained. Counts come from the test runner's own output.

| Requirement | Title | Tests | Status |
|---|---|---|---|
| REQ-001 | The specification file must exist and be readable | 4 | Passed |
| REQ-002 | YAML and JSON specifications are both accepted | 2 | Passed |
| REQ-003 | Only OpenAPI 3.0.x is accepted (D-001) | 11 | Passed |
| REQ-004 | The document must be a valid OpenAPI 3.0 document, with one tolerated exception | 5 | Passed |
| REQ-005 | Internal `$ref` is resolved; an unresolvable `$ref` is a load-time failure | 3 | Passed |
| REQ-006 | Configuration is validated, and documented defaults apply | 9 | Passed |
| REQ-007 | Fail fast: a specification problem never binds a port (`CLAUDE.md` invariant 5) | 3 | Passed |
| REQ-008 | Load-time errors are actionable | 5 | Passed |
| REQ-009 | Unsupported constructs are rejected at load time with a structured report | 3 | Passed |
| REQ-010 | The rejected constructs, and their tokens | 8 | Passed |
| REQ-011 | All unsupported constructs are reported in one error | 2 | Passed |
| REQ-012 | Accepted-but-ignored constructs never fail the load | 7 | Passed |
| REQ-013 | Every documented operation is routed at its path template | 4 | Passed |
| REQ-014 | Path parameters match exactly one path segment | 5 | Passed |
| REQ-015 | Literal segments win over template segments | 3 | Passed |
| REQ-016 | An unmatched path is `ROUTE_NOT_FOUND` | 4 | Passed |
| REQ-017 | A matched path with an undocumented method is `METHOD_NOT_ALLOWED` | 5 | Passed |
| REQ-018 | The base path comes from the path component of `servers[0].url` | 15 | Passed |
| REQ-019 | Path parameters are validated against their schema | 4 | Passed |
| REQ-020 | Query parameters are validated; undeclared query parameters are ignored | 11 | Passed |
| REQ-021 | Header parameters are validated, case-insensitively by name | 4 | Passed |
| REQ-022 | Request bodies are validated against the documented schema | 6 | Passed |
| REQ-023 | An undocumented request media type is `415` | 3 | Passed |
| REQ-024 | A malformed JSON request body is `400` | 2 | Passed |
| REQ-025 | `readOnly` and `writeOnly` have explicit, opposite effects | 3 | Passed |
| REQ-026 | Validation failures report every violation, in a stable shape | 2 | Passed |
| REQ-027 | The default status code is the lowest documented 2xx | 5 | Passed |
| REQ-028 | `Prefer: code=NNN` selects a documented response | 3 | Passed |
| REQ-029 | An undocumented preferred status is `NO_RESPONSE_FOR_STATUS` | 2 | Passed |
| REQ-030 | Media type selection prefers `application/json` | 4 | Passed |
| REQ-031 | A selected response with content but no JSON media type is `406` | 2 | Passed |
| REQ-032 | A response with no content is served with an empty body | 2 | Passed |
| REQ-033 | Payload precedence within the selected media type | 8 | Passed |
| REQ-034 | `Prefer: example=<name>` selects a named example | 5 | Passed |
| REQ-035 | `Prefer` parsing rules | 14 | Passed |
| REQ-036 | An applied preference is echoed in `Preference-Applied` | 3 | Passed |
| REQ-037 | A deprecated operation is marked in the response | 3 | Passed |
| REQ-038 | A generated body conforms to the response schema | 8 | Passed |
| REQ-039 | `writeOnly` properties are never generated | 2 | Passed |
| REQ-040 | A generation failure is reported, not hidden | 2 | Passed |
| REQ-041 | Response `Content-Type` | 3 | Passed |
| REQ-042 | Every mock error has the same body shape | 3 | Passed |
| REQ-043 | Every response declares its origin | 3 | Passed |
| REQ-044 | Generated responses expose how they were produced | 5 | Passed |
| REQ-045 | Error codes and their HTTP statuses | 10 | Passed |
| REQ-046 | A documented error is never confused with a mock error | 4 | Passed |
| REQ-047 | Usage output | 4 | Passed |
| REQ-048 | `--spec` is required | 2 | Passed |
| REQ-049 | Options map to the configuration, with CLI defaults | 4 | Passed |
| REQ-050 | Invalid or unknown options exit with code 2 | 4 | Passed |
| REQ-051 | Startup, failure reporting and shutdown | 4 | Passed |
| REQ-052 | Determinism (`CLAUDE.md` invariant 6) | 7 | Passed |
| REQ-053 | Concurrent and repeated instances do not interfere | 2 | Passed |
| REQ-054 | Seed scope: the effective seed is derived from the seed and the request | 6 | Passed |
| REQ-055 | Statelessness (ARCHITECTURE §1) | 4 | Passed |
| REQ-056 | Lifecycle contract (ARCHITECTURE §3) | 6 | Passed |
| REQ-057 | Silence by default | 1 | Passed |
| REQ-058 | Startup cost | 1 | Passed |

**58 requirements, 269 acceptance tests, none uncovered.**

## Execution summary

| Suite | Files | Tests | Result |
|---|---|---|---|
| `npm run test:unit` | 6 | 100 | passed |
| `npm run test:acceptance` | 11 | 269 | passed |
| `npm test` | 17 | 369 | passed |

Acceptance runs take roughly 20 seconds. Each test binds a real ephemeral port and speaks HTTP over
it; no test uses an in-process injection shortcut.

## Known limitations

These are accepted, not defects. Each was a deliberate trade recorded when it was made.

1. **The suite and the implementation share a validator.** Both check bodies with the same AJV
   instance configuration and the same OAS-to-JSON-Schema converter. These are third-party
   libraries rather than the Developer's code, so the suite is not coupled to the implementation —
   but a bug in the converter would be invisible to both sides. An independent second validator
   costs more than the risk it removes. See `docs/TEST-PLAN.md` §7.1 and D-007.
2. **Generated values are re-validated because the generator cannot be trusted** with contradictory
   constraints. This step is load-bearing; removing it would turn REQ-040 from an error into a
   passing response carrying a non-conforming body. See D-007.
3. **Windows cannot deliver a real `SIGINT` to a child process**, so REQ-051's shutdown test asserts
   port release on every platform but the exit code only on POSIX.
4. **Two criteria are untestable by the requirements' own design** — the HTTP status of load-time
   errors (REQ-008 places it outside the contract) and REQ-057's second criterion. Their absence
   from the suite is deliberate and recorded, not an oversight.
5. **`format: int64` generates values beyond the exactly-representable range** of a double, for
   example `5325863305791668000`. This conforms to the schema, so it is not a defect against any
   requirement, but a user of the mock will notice it. A candidate for the first follow-up.

Everything excluded from the MVP is listed in `docs/REQUIREMENTS.md` §7, with a reason per line.

## Process notes

The point of separating requirements, testing and implementation across agents with isolated context
was to find out whether the separation catches anything. It did, and the record is more useful than
the verdict.

**Writing the tests found three defects in the approved requirements.** REQ-054 and REQ-052 were
unsatisfiable on the very specification they named — their criteria required a generated payload from
an operation whose response declares an `examples` map, which by REQ-033 and REQ-044 serves an example
and emits no seed. REQ-044 was silent about one of the four payload precedence levels. REQ-051
contradicted REQ-049 at the CLI's default log level. None of these would have surfaced from reading
the document; all three surfaced from trying to assert against it.

**Implementing found a fourth.** REQ-033's precedence rule for a media type declaring both `example`
and `examples` could not coexist with REQ-004's meta-schema enforcement, because the meta-schema
forbids that combination outright. Resolved as D-006.

**Two agent claims did not survive verification.** The QA engineer reported REQ-018's sixth rule as
untestable, having failed to construct a string that passes OpenAPI validation but fails URL parsing;
`http://[` does both, the rule stayed, and the test was written. The orchestrator's own earlier
description of subagent tool restrictions was also wrong in practice — see below.

**One process rule was enforced by the wrong mechanism.** Claude Code loads subagent definitions at
session start, so the agent files created during this session were not registered until later. The
Business Analyst and QA Engineer therefore ran as general-purpose agents following their role file as
an instruction, without the `tools` restriction that file declares. The Business Analyst disclosed,
unprompted, that it had run one read-only shell command in violation of its role — a violation nobody
would otherwise have detected, since subagent transcripts are not read. This is exactly why D-003
records the git check, not the `tools` field, as the real gate: the boundary that mattered held, and
it held because it was mechanical.

**The Developer's report was accurate in every particular that was checked**, including its own
disclosure of an unapproved workaround it had implemented. That disclosure is what turned a silent
deviation into D-006.

## Follow-ups

Not defects; the nearest useful next iterations, in rough order of value.

1. OpenAPI 3.1.x support (D-001 deferred it; it needs a second validation branch).
2. Bound `format: int64` generation to a realistic range.
3. `server.variables` expansion for templated server URLs (REQ-018 ignores them today).
4. Circular `$ref` support behind a stated depth policy (REQ-010 rejects them today).
5. Latency simulation and error injection, for which REQ-035's ignored-directive rule already
   leaves room in the `Prefer` grammar.
