# local-mock-server

Serve dynamic HTTP responses from a local **OpenAPI 3.0.x** specification, so client integrations
can be developed and tested without a real backend.

> **Status: in development.** The project is being built with an AI-assisted SDLC in which
> requirements, the acceptance suite and the implementation are produced by separate agents with
> isolated context. This README is filled in at acceptance.

## Quick start

```bash
npm install
npm run dev -- --spec examples/petstore.yaml --port 4010 --seed 42
```

```bash
curl -i localhost:4010/pets
curl -i -H "Prefer: code=404" localhost:4010/pets/1
```

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Pipeline, public contract, technology choices |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Numbered requirements with acceptance criteria |
| [docs/TEST-PLAN.md](docs/TEST-PLAN.md) | Test strategy and the traceability matrix |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log with rationale and rejected alternatives |
| [CLAUDE.md](CLAUDE.md) | Working agreement: file ownership and invariants |

## Development

```bash
npm run typecheck        # tsc --noEmit
npm run test:unit        # unit tests
npm run test:acceptance  # independent acceptance suite (real HTTP)
npm test                 # full regression
```

## License

MIT
