# skillflag

[![npm version](https://img.shields.io/npm/v/skillflag.svg)](https://www.npmjs.com/package/skillflag)
[![npm downloads](https://img.shields.io/npm/dm/skillflag.svg)](https://www.npmjs.com/package/skillflag)
[![CI](https://github.com/dutifuldev/skillflag/actions/workflows/ci.yml/badge.svg)](https://github.com/dutifuldev/skillflag/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

skillflag is a minimal CLI convention for bundling, listing and installing [agent skills](https://agentskills.io), so that you don't have to upload them to separate 3rd party skill registries.

Spec: [Skillflag Specification](docs/SKILLFLAG_SPEC.md)

This repository holds the spec and four implementations of it — TypeScript (the reference), Go, Python, and Rust. They implement the same standard: identical flags, identical output, byte-identical skill exports, verified by a shared conformance suite.

## Motivation

Think of skillflag as "`--help` or `manpage` for skills": a stable flag-based interface to list and export bundled skills without having to upload it to a third party registry. Any relevant agent instructions live right inside your repo and get published together alongside your tool.

[Agent skills](https://agentskills.io) are self-contained capability packages: a folder with a `SKILL.md` (name, description, instructions) plus any scripts, templates, and references the agent needs to execute a specific workflow.

With skillflag, CLI tools can bundle and list these skills without having to upload it to a skill registry. With `--skill list|show|export`, any agent can discover and install instructions that are required to use the tool.

## Example

Suppose that you have installed a CLI tool to control Philips Hue lights at home, `hue-cli`.

To list the skills that the tool can export, you can run:

```
$ hue-cli --skill list
philips-hue    Control Philips Hue lights in the terminal
```

You can then install it to your preferred coding agent, such as Claude Code:

```
$ hue-cli --skill export philips-hue | npx skillflag install --agent claude
Installed skill philips-hue to .claude/skills/philips-hue
```

You can optionally install the skill to `~/.claude`, to make it global across repos:

```
$ hue-cli --skill export philips-hue | npx skillflag install --agent claude --scope user
Installed skill philips-hue to ~/.claude/skills/philips-hue
```

Even better, once this convention becomes commonplace, agents will by default do all these before they even run the tool, so when you ask it to "install hue-cli", it will know to run `--skill list` the same way a human would run `--help` after downloading a program, and install the necessary skills themselves without being asked to.

## Implementations

Pick the package that matches your CLI's language. Each one provides the same producer library (to embed `--skill` in your CLI) and the same installer, all of them export byte-identical skill bundles, and every package ships the same two binaries: `skillflag` and `skill-install`.

| Language   | Package                                                            | Install                                            |
| ---------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| TypeScript | [`skillflag`](https://www.npmjs.com/package/skillflag) (reference) | `npm install -g skillflag`                         |
| Go         | `github.com/osolmaz/skillflag/go`                                  | `go install .../go/cmd/skillflag@latest` (see below) |
| Python     | `skillflag`                                                        | `uv tool install skillflag`                        |
| Rust       | `skillflag`                                                        | `cargo install skillflag --locked`                 |

```sh
npm install -g skillflag
go install github.com/osolmaz/skillflag/go/cmd/skillflag@latest
go install github.com/osolmaz/skillflag/go/cmd/skill-install@latest
uv tool install skillflag
cargo install skillflag --locked
```

Because the binaries share names, keep one implementation on your PATH at a time (they are interchangeable).

Because every installer speaks the same standard, you only need one of them on your PATH — a Rust producer's export pipes into the npm installer just fine:

```bash
my-rust-tool --skill export my-skill | npx skillflag install --agent codex --scope repo
```

The TypeScript package is the reference implementation and additionally ships the interactive multi-select install wizard; the ports keep prompts minimal.

## Quick setup — add skillflag to your CLI

Copy the prompt below and paste it into your coding agent. It will add skillflag support to your project.

```text
Add skillflag to this project so the CLI can bundle and expose agent skills.

1. Install the skillflag library for the project's language:
   TypeScript: npm install skillflag
   Go:         go get github.com/osolmaz/skillflag/go
   Python:     add skillflag to the project dependencies
   Rust:       cargo add skillflag

2. Create a skill directory at skills/<skill-id>/SKILL.md or
   .agents/skills/<skill-id>/SKILL.md with a YAML frontmatter
   (name, description) and markdown instructions for the agent.

3. In the CLI entrypoint, intercept --skill and delegate to skillflag.
   TypeScript example:

   import { findSkillsRoot, maybeHandleSkillflag } from "skillflag";

   await maybeHandleSkillflag(process.argv, {
     skillsRoot: findSkillsRoot(import.meta.url),
   });

   The Go, Python, and Rust libraries expose the same pair of entry
   points under idiomatic names.

4. Verify it works:
   <tool> --skill list
   <tool> --skill show <id>
   <tool> --skill export <id> | npx skillflag install

5. For the full integration guide:
   https://raw.githubusercontent.com/dutifuldev/skillflag/main/docs/INTEGRATION.md

6. For the skillflag specification:
   https://raw.githubusercontent.com/dutifuldev/skillflag/main/docs/SKILLFLAG_SPEC.md
```

## Quick start

Any CLI that implements the skillflag convention can be used like this:

```bash
# list skills the tool can export
<tool> --skill list
# show a single skill's metadata
<tool> --skill show <id>
# install into Codex user skills
<tool> --skill export <id> | npx skillflag install --agent codex
# install into Claude project skills
<tool> --skill export <id> | npx skillflag install --agent claude --scope repo
```

### Interactive mode

When `--agent` or `--scope` is omitted and a TTY is available, `skill-install` launches an interactive wizard:

```bash
# pipe a skill and let the wizard guide you
<tool> --skill export <id> | npx skillflag install
```

The wizard lets you pick agents and scopes with arrow keys and space to select, then confirms before installing. This works even when stdin is piped. (TypeScript implementation only; the Go/Python/Rust installers fall back to simple numbered prompts.)

### Multi-target install

`--agent` and `--scope` flags accept a single value each.
To install to multiple agents/scopes in one run, use the interactive wizard:

```bash
<tool> --skill export <id> | npx skillflag install
```

In the wizard, select multiple entries with space, then confirm the matrix install.

## Supported agents

codex, claude, portable, vscode, copilot, amp, goose, opencode, factory, cursor

## Supported scopes

| Scope  | Description                                                   |
| ------ | ------------------------------------------------------------- |
| `repo` | Install into the current repository (e.g. `.codex/skills/`)   |
| `user` | Install into the user's home config (e.g. `~/.codex/skills/`) |
| `cwd`  | Install relative to the current working directory             |

## Repository layout

- `docs/` — the spec, the [deterministic tar contract](docs/DETERMINISTIC_TAR.md), and the [integration guide](docs/INTEGRATION.md)
- `typescript/`, `go/`, `python/`, `rust/` — the four implementations
- `skills/skillflag/` — the canonical bundled skill (mirrored into each package by `make sync-skills`)
- `fixtures/` — shared test fixtures
- `scripts/check-conformance.mjs` — cross-implementation conformance suite (`make conformance`)

Development gate: `make check` from the repo root. See [AGENTS.md](AGENTS.md) for contribution rules.

## Bundled skill

Every implementation ships a single bundled skill, `skillflag`, that documents both the producer flags and the installer.

## License

[MIT](LICENSE)
