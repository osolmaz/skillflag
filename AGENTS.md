# Agent Instructions

This repository holds the Skillflag specification and four implementations of
it: `typescript/` (the reference, published to npm as `skillflag`), `go/`,
`python/` (`skillflag-py`), and `rust/` (`skillflag-rs`).

## Ground rules

- The contract lives in `docs/SKILLFLAG_SPEC.md` and
  `docs/DETERMINISTIC_TAR.md`. Behavior changes start there, then land in the
  TypeScript reference, then in the other implementations — never in one port
  alone.
- Exports must stay byte-identical across implementations. Any change to tar
  writing, entry ordering, JSON output, or digests must keep
  `make conformance` green.
- The canonical bundled skill is `skills/skillflag/`. Never edit the copies
  inside the packages; edit the canonical one and run `make sync-skills`.
- Keep runtime dependencies at zero in the Go, Python, and Rust ports (Rust
  allows `sha2`/`tar`). The TypeScript package keeps only `tar-stream` and
  `@clack/prompts`.
- Run `make check` (or the relevant `make check-<lang>`) from the repo root
  before finishing any change.

## Per-language notes

- **TypeScript**: strict tsconfig, eslint `--max-warnings 0`, prettier,
  `node --test` integration tests. Interactive wizard behavior is
  reference-only; ports keep prompts minimal.
- **Go**: stdlib only, `gofmt` clean, `go vet` clean, tests via `go test ./...`.
  Public API is `go/skillflag`; everything else stays under `go/internal`.
- **Python**: uv-managed, src layout, ruff format + lint, pytest. Stdlib only
  at runtime.
- **Rust**: cargo workspace, `cargo fmt --check`, clippy with `-D warnings`.
  Hand-rolled tar writer and JSON emitter stay dependency-light on purpose.

## Releases

Each package versions and releases independently: npm `skillflag` uses plain
`v*` tags via the existing release-it workflow; the ports use `go/v*`,
`python/v*`, and `rust/v*` tags with their own workflows.
