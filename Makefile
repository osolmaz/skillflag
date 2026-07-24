# Local development gate. CI (.github/workflows/ci.yml) runs the same steps.

.PHONY: check check-typescript check-go check-python check-rust conformance sync-skills check-skills-sync

check: check-skills-sync check-typescript check-go check-python check-rust conformance

check-typescript:
	cd typescript && npm run format:check
	cd typescript && npm run lint
	cd typescript && npm test

check-go:
	cd go && test -z "$$(gofmt -l .)"
	cd go && go vet ./...
	cd go && go test ./...
	cd go && go build ./cmd/skillflag-go ./cmd/skill-install-go

check-python:
	cd python && uv sync
	cd python && uv run ruff format --check .
	cd python && uv run ruff check .
	cd python && uv run pytest

check-rust:
	cd rust && cargo fmt --check
	cd rust && cargo clippy --workspace --all-targets -- -D warnings
	cd rust && cargo test

conformance:
	node scripts/check-conformance.mjs --require-all

sync-skills:
	node scripts/sync-skills.mjs

check-skills-sync:
	node scripts/sync-skills.mjs --check
