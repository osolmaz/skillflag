# Local development gate. CI (.github/workflows/ci.yml) runs the same steps.

.PHONY: check check-typescript check-go check-python check-rust conformance sync-skills check-skills-sync

check: check-skills-sync check-typescript check-go check-python check-rust conformance

check-typescript:
	cd typescript && npm run format:check
	cd typescript && npm run lint
	cd typescript && npm test

# GOWORK=off: a user-level go.work above the repo must not affect the build.
# golangci-lint runs when installed locally; CI always runs it (pinned).
check-go:
	cd go && test -z "$$(gofmt -l .)"
	cd go && if command -v golangci-lint >/dev/null; then GOWORK=off GOFLAGS=-buildvcs=false golangci-lint run ./...; else echo "golangci-lint not installed; skipping (CI runs it)"; fi
	cd go && GOWORK=off go vet ./...
	cd go && GOWORK=off go test ./...
	cd go && GOWORK=off go build -o /dev/null ./cmd/skillflag && GOWORK=off go build -o /dev/null ./cmd/skill-install

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
