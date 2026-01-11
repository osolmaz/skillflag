---
title: Skillflag Node/TypeScript Implementation Plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-01-11
---

## Goal

Implement a Skillflag-compliant **producer CLI** in Node.js + TypeScript (ESM), following the SimpleDoc stack/workflows, with the minimum required interface:

- `--skill list`
- `--skill export <id>`

Optional (nice-to-have) per spec:

- `--skill list --json`
- `--skill show <id>`

## Non-goals

- Implementing the installer (`skill-install`).
- Defining per-agent install paths or any install automation.

## Stack and conventions (mirror SimpleDoc)

- Node.js >= 18, TypeScript, ESM (`"type": "module"`).
- `tsc` builds to `dist/`.
- ESLint + Prettier with zero-warning policy.
- Tests with Node’s built-in `node:test` (SimpleDoc style).

## Proposed project layout

```
skillflag/
  src/
    bin/
      skillflag.ts        # CLI entry
    core/
      list.ts             # discovery logic
      export.ts           # tar export
      show.ts             # optional
      paths.ts            # skills root + id validation
      tar.ts              # deterministic tar creation
      digest.ts           # sha256 streaming
      errors.ts
  test/
    fixtures/skills/...
    integration/...
  skills/                 # bundled skills (if any)
```

## Implementation plan

### Phase 1 — Scaffolding and tooling

1. Initialize `package.json` similar to SimpleDoc:
   - `build` → `tsc -p tsconfig.json`
   - `lint` → `eslint . --max-warnings 0`
   - `format` / `format:check` → Prettier
   - `test` → `tsc -p tsconfig.test.json` + `node --test`
2. Add `tsconfig.json`, `tsconfig.test.json` mirroring SimpleDoc settings.
3. Add `eslint.config.js` with TypeScript ESLint setup.
4. Add `src/bin/skillflag.ts` as the CLI entry.

### Phase 2 — Skill discovery (`--skill list`)

1. Define `skillsRoot` (default: `skills/` at repo/package root).
2. List directories directly under `skills/`.
3. Output only IDs to stdout, one per line, no extra text.
4. Enforce stable lexicographic ordering.
5. Errors go to stderr; exit code `1`.

### Phase 3 — Deterministic export (`--skill export <id>`)

1. Validate `<id>` exists and contains `<id>/SKILL.md`.
2. Walk the directory, collect file list, sort lexicographically.
3. Create a tar stream (PAX or ustar) with fixed metadata:
   - `mtime = 0`, `uid/gid = 0`, `uname/gname = ""`
4. Enforce path safety:
   - no absolute paths
   - no `..`
5. Stream tar to stdout, no extra output.

### Phase 4 — JSON list (`--skill list --json`)

1. Produce the JSON schema from spec, with `digest` required.
2. Compute `sha256` digest of the deterministic tar stream per skill.
3. Include optional fields (`summary`, `version`, `files`) only when present.
4. Omit `null` fields; empty string invalid for `version` and `digest`.

### Phase 5 — Optional `--skill show <id>`

- Print `<id>/SKILL.md` to stdout only.

### Phase 6 — Tests

- Fixtures under `test/fixtures/skills/*`.
- Integration tests:
  - list output (text + json)
  - export stream structure (top-level `<id>/` only, contains `SKILL.md`)
  - deterministic output (same hash on repeated export)
  - safety: reject absolute paths / `..`

## Acceptance criteria

- `--skill list` prints only IDs (stable order), no stdout noise.
- `--skill export <id>` streams a valid tar with exactly one top-level `<id>/` and `<id>/SKILL.md`.
- Export is deterministic (matching digests).
- All errors go to stderr, exit `1` on failure.
- JSON listing includes `digest` and conforms to the spec.

## Open questions

- Should `skills/` be configurable via env or CLI flag (e.g., `SKILLFLAG_ROOT`)?
- Do we want to parse `SKILL.md` frontmatter for `summary`/`version`, or keep JSON minimal?
- Which tar library to use (`tar`, `tar-stream`, or a tiny custom packer)?
