# Skillflag Specification

Version: 0.1 (draft)
Status: Informational + Normative (uses **MUST / SHOULD / MAY**)

## 1. Abstract

**Skillflag** is a CLI convention for exposing “agent skills” (skill directories, not just single markdown files) from a CLI tool via standardized flags, so that:

* the **producing CLI** does *not* contain agent- or editor-specific installation logic, and
* a separate **installer/adaptor CLI** (or simple shell redirection) can install a chosen skill into a chosen agent tool and scope.

Skillflag defines two primary operations:

* **Discovery**: `--skills`
* **Export**: `--skill <id> --export` (exports the full skill directory as a tar stream on stdout)

## 2. Motivation

Skillflag is designed around these constraints:

1. **OS-independent distribution**
   CLIs may be installed via language ecosystems (npm, cargo, pip, etc.) and run cross-platform. Filesystem conventions like global manpage directories are not a reliable assumption.

2. **Skills are more than a markdown file**
   A skill often includes scripts, templates, schemas, examples, test fixtures, or other assets that must be shipped as a directory bundle.

3. **Avoid per-agent installation logic in producer CLIs**
   It is undesirable for every CLI to learn how to install into every agent tool (Claude Code, Codex, Amp, etc.) and every scope (repo/user/system). That mapping belongs in a separate adaptor installer.

4. **Bundling skills with the CLI package is simpler than maintaining a separate registry**
   Publishing skills alongside the CLI’s normal distribution mechanism reduces operational overhead and version skew.

5. **Users want selective installation**
   Installing a CLI should not implicitly install all of its skills into all local agent tools. Users should be able to list available skills and install only what they want, where they want.

## 3. Goals and non-goals

### 3.1 Goals

* Provide a **minimal**, **portable**, **shell-friendly** interface:

  * list skills
  * export a skill directory
* Keep producer CLIs **tool-agnostic** (no knowledge of target agent install paths).
* Enable both interactive use (humans) and automation (scripts/CI).

### 3.2 Non-goals

* Defining how a specific agent tool discovers skills on disk.
* Defining a central skill registry, marketplace, signing infrastructure, or dependency installation mechanism.
* Defining how installers resolve conflicts, pin versions, or manage lockfiles (those can exist, but are outside the core Skillflag interface).

## 4. Terminology

* **Producer CLI**: The tool that *bundles* skills and implements the Skillflag interface (e.g., `mycli`).
* **Skill**: A directory containing `SKILL.md` and optional additional files (scripts/assets/etc.).
* **Skill ID**: The identifier used with `--skill <id>`.
* **Exporter**: The part of the producer CLI that emits the skill bundle.
* **Installer/Adaptor CLI**: A separate tool that consumes a skill directory (or tar stream) and installs it into a specific agent tool and scope.

## 5. Required CLI flags

A Skillflag-compliant producer CLI **MUST** implement:

1. `--skills`
2. `--skill <id> --export`

A producer CLI **MAY** additionally implement:

* `--skills --json`
* `--skill <id>` (without `--export`) as a “view” mode

Skillflag does **not** require any particular command substructure (`tool skills ...`) because the goal is a “`--help`-class” universal convention based on flags.

## 6. Discovery: `--skills`

### 6.1 Behavior

* `tool --skills` **MUST** print the list of available Skill IDs to **stdout**.
* Output **MUST NOT** include banners, progress text, or other non-data content on stdout.
* Diagnostics and errors **MUST** go to **stderr**.

### 6.2 Output format (text)

* Each skill **MUST** appear on a single line.
* The line **MUST** begin with the `Skill ID`.
* A short summary **MAY** follow, separated by a single tab (`\t`).

Recommended format:

```
<id>\t<summary>
```

If summaries are included:

* `<summary>` **MUST NOT** contain newlines or tabs.

### 6.3 Ordering

* Output ordering **SHOULD** be stable and predictable.
* Recommended: sort lexicographically by Skill ID.

### 6.4 Optional JSON mode

If `tool --skills --json` is provided:

* It **MUST** print a single JSON object to stdout.
* It **MUST NOT** print additional text to stdout.

Minimal recommended schema:

```json
{
  "skillflag_version": "0.1",
  "skills": [
    {
      "id": "tmux",
      "summary": "Drive an interactive tmux session",
      "version": "optional string",
      "files": "optional: list or count",
      "digest": "optional: sha256 of exported tar stream"
    }
  ]
}
```

(Fields beyond `id` are optional; keeping JSON minimal is consistent with the “lindy” goal.)

## 7. Viewing: `--skill <id>` (optional)

Because `--skill <id> --export` is the normative export mechanism, `--skill <id>` without `--export` is optional. If implemented:

* `tool --skill <id>` **SHOULD** print a human-oriented representation of the skill to stdout.
* Recommended: print `<id>/SKILL.md` content only (no extra banners).

This provides a “manpage-like” experience without OS-specific manpage infrastructure.

## 8. Export: `--skill <id> --export`

### 8.1 Behavior

* `tool --skill <id> --export` **MUST** write the skill bundle to **stdout** as a tar stream.
* The tar stream **MUST** contain exactly one top-level directory named `<id>/`.
* The directory **MUST** include `<id>/SKILL.md`.
* No additional output is permitted on stdout.

### 8.2 Tar format requirements

To maximize portability, exporters:

* **MUST** produce a tar that can be read by common `tar` implementations.
* **SHOULD** use one of:

  * POSIX ustar, or
  * PAX tar (recommended if long paths are needed)

Exporters **MUST** ensure:

* No absolute paths.
* No `..` path traversal segments.
* All entries are relative under `<id>/`.

### 8.3 Determinism (recommended)

For reproducible installs and caching:

* Exporters **SHOULD** emit entries in stable order.
* Exporters **MAY** normalize metadata (mtime/uid/gid/uname/gname) to stable values.

Determinism is recommended but not required for conformance.

### 8.4 Error handling and exit codes

A compliant implementation **MUST** return non-zero exit status on failure and **MUST** write error details to stderr.

Recommended exit code conventions:

* `0`: success
* `2`: usage error / invalid flags
* `3`: skill not found (`--skill <id>` unknown)
* `4`: I/O error producing output (broken pipe, permission, etc.)
* `5`: internal error

(Exact codes may vary, but “not found” vs “usage error” separation is strongly recommended for scripting.)

## 9. Skill directory layout (bundling convention)

Inside the producer CLI’s distribution artifact, skills **SHOULD** be stored under a dedicated resource path:

* `skills/<id>/SKILL.md` (required)
* `skills/<id>/...` (optional additional files)

The producer CLI **MUST** map these bundled resources to the Skillflag interface:

* `--skills` enumerates available `<id>` directories.
* `--skill <id> --export` exports the directory as `<id>/...` in tar form.

This deliberately avoids any assumption about package managers or OS-level install roots.

## 10. Skill ID conventions

Skill IDs **SHOULD** be:

* stable across releases once published
* ASCII lowercase, digits, and `-` / `_` (recommended)
* no spaces

Rationale: IDs appear in shell scripts and filesystem paths.

## 11. Metadata (optional, minimal)

Skillflag does not require a manifest file, but implementations **MAY** include metadata in one of these ways:

* YAML frontmatter at the top of `SKILL.md` (common in markdown-based systems)
* a sidecar file such as `SKILL.json` or `skill.toml`

If metadata exists, it **SHOULD** be treated as advisory by installers.

Critically:

* **Producer CLIs MUST NOT execute** any bundled scripts as part of export.
* Installers **SHOULD NOT execute** bundled scripts by default.

## 12. Security considerations

Skillflag keeps the producer CLI in a “data export” role. That reduces risk, but does not eliminate it.

Recommendations:

* Exporters must prevent path traversal and absolute paths (normative requirement).
* Installers should treat exported bundles as untrusted input:

  * provide `--dry-run` / `--inspect`
  * optionally require explicit opt-in to execute any included scripts
* Bundles may include binaries or scripts; installers should surface that fact clearly.

## 13. Interoperability with a separate installer

Skillflag is designed to compose cleanly with a dedicated installer/adaptor CLI that knows how to install into specific agent tools and scopes.

Expected pipeline shape:

```bash
tool --skill <id> --export | skill-install --agent <agent> --scope <scope>
```

The installer is responsible for:

* mapping to agent-specific directories and precedence
* conflict resolution
* optional linking vs copying
* optional lockfiles / version pinning

None of that logic belongs in the producer CLI.

## 14. Examples

### 14.1 List skills

```bash
tool --skills
```

### 14.2 View the skill documentation (if supported)

```bash
tool --skill tmux
```

### 14.3 Export and inspect without installing

```bash
tool --skill tmux --export | tar -tf -
```

### 14.4 Export and install via an adaptor

```bash
tool --skill tmux --export | skill-install --agent codex --scope user
```

### 14.5 Export and manually place somewhere (no adaptor needed)

```bash
mkdir -p .agents/skills/tmux
tool --skill tmux --export | tar -x -C .agents/skills
```

(That last example assumes the installer semantics are simply “untar into a skills root”.)

## 15. Conformance checklist

A producer CLI is **Skillflag-compliant** if:

- [ ] `--skills` lists Skill IDs on stdout with no extra stdout noise.
- [ ] `--skill <id> --export` emits a tar stream on stdout.
- [ ] The tar stream contains exactly one top-level directory `<id>/`.
- [ ] `<id>/SKILL.md` exists in the exported stream.
- [ ] No absolute paths or path traversal segments appear in the tar entries.
- [ ] Failures produce non-zero exit code and write errors to stderr.

---

# `skill-install` companion spec (installer side)

Scope: installs **one** skill bundle into **one** target agent/tool + scope.

### Motivation

* **Skills are directories**, not just `SKILL.md`: they can include scripts, templates, references, assets, etc. (multiple tools describe skills this way). ([OpenAI Developers][1])
* **Producer CLIs should not encode per-agent install logic.** The producer just exposes skill bundles (via Skillflag: `--skills`, `--skill <id> --export`). The installer maps to agent-specific locations.
* **Users must opt in**: installing a CLI must not automatically install all of its skills into every local agent. So `skill-install` targets exactly one agent and one scope at a time.
* **Cross-agent portability exists but paths differ**: several tools already read “portable” directories (notably `.agents/skills` and `~/.config/agents/skills`), while others have native roots like `.claude/skills`, `.codex/skills`, `.github/skills`, etc. ([Block][2])


## 1) Inputs `skill-install` accepts

### 1.1 Directory input

Install from a local skill directory:

* `PATH` **must** be a directory containing `SKILL.md` at its root.

Example:

```bash
skill-install ./skills/tmux --agent claude --scope repo
```

### 1.2 Stream input (tar on stdin)

Install from a tar stream (e.g., produced by a Skillflag producer’s export):

* If `PATH` is omitted and stdin is not a TTY, `skill-install` **must** read a tar stream from stdin.
* The tar stream **should** contain a single top-level directory `<something>/...` with `SKILL.md` inside that root.

Example:

```bash
producer --skill tmux --export | skill-install --agent claude --scope user
```

(Producer-side export format is defined by Skillflag: `--skill <id> --export` emits a tar bundle on stdout.)


## 2) CLI surface (minimal, stable)

### 2.1 Synopsis

```bash
skill-install [PATH]
  --agent <claude|codex|vscode|copilot|cursor|amp|goose|opencode|factory|portable>
  --scope <repo|user|cwd|parent|admin>
  [--root <path>]
  [--mode <copy|link>]
  [--force]
  [--dry-run]
  [--json]
  [--id <override-skill-id>]
  [--dest <override-destination-root>]
  [--native]        # only for agents where “portable-first” is the default (goose/amp)
  [--legacy]        # only where a legacy target exists (vscode/copilot -> .claude/skills)
```

### 2.2 Required flags

* `--agent` is **required** unless `--dest` is provided.
* `--scope` is **required** unless `--dest` is provided.

Rationale: avoid silent installs into the wrong agent/tool.


## 3) Skill identification and validation

### 3.1 What `skill-install` must validate

By default, `skill-install` **must** validate:

* `SKILL.md` exists at bundle root.
* YAML frontmatter exists and includes:

  * `name` (string)
  * `description` (string)

This matches major implementations’ documented expectations. ([Claude Code][3])

### 3.2 Skill ID selection (destination folder name)

Default `skill_id` is the YAML `name`.

* Destination directory name **must** be `skill_id` unless overridden by `--id`.
* If the incoming bundle root directory name differs from `skill_id`, `skill-install` **should** rename on install (and may warn on stderr).


## 4) Repo root resolution (for `--scope repo`)

When `--scope repo` is used:

* If inside a git worktree, `skill-install` **should** use the git repository root as `<project-root>`.
* Otherwise, it **should** use the current working directory as `<project-root>`.
* `--root <path>` overrides detection.


## 5) Install modes and conflict rules

### 5.1 `--mode copy` (default, required)

* Copy the entire skill directory tree to the destination.
* Preserve file contents exactly; preserve execute bits when the platform supports it.
* Should install atomically (write temp dir then rename) to avoid partial installs.

### 5.2 `--mode link` (optional)

* Create a symlink/junction at the destination pointing to the source directory (or to an extracted cache if input was a tar stream).
* If linking is unsupported, fail unless the user explicitly chose a fallback.

### 5.3 Conflicts

If the destination already exists:

* Default behavior: **fail** without modifying anything.
* `--force`: remove and replace.

### 5.4 No code execution

`skill-install` **must not** run any scripts contained in the skill bundle as part of installation.


## 6) Security requirements (tar extraction)

When reading a tar stream, `skill-install` **must**:

* Reject absolute paths.
* Reject `..` traversal.
* Reject special files (device nodes/FIFOs).
* Treat symlinks/hardlinks as unsafe by default:

  * recommended: reject them outright, or ensure they stay within the extracted skill root.


## 7) Destination mapping (what `--agent` + `--scope` means)

This section is intentionally concrete and only covers widely-used tools with documented/observable conventions.

### 7.1 `--agent portable` (recommended cross-agent target)

Portable roots are explicitly used by Amp and Goose and described as portable across agents in Goose docs. ([Block][2])

* `--scope repo` → `<project-root>/.agents/skills/<skill_id>/`
* `--scope user` → `${XDG_CONFIG_HOME:-~/.config}/agents/skills/<skill_id>/`

### 7.2 `--agent claude` (Claude Code)

Claude Code documents these locations and precedence. ([Claude Code][3])

* `repo` → `<project-root>/.claude/skills/<skill_id>/`
* `user` → `~/.claude/skills/<skill_id>/`

### 7.3 `--agent codex` (OpenAI Codex CLI / IDE)

Codex documents multiple repo layers and user/admin/system scopes. ([OpenAI Developers][1])

Default mapping:

* `repo` → `<project-root>/.codex/skills/<skill_id>/`
* `user` → `${CODEX_HOME:-~/.codex}/skills/<skill_id>/`
* `admin` → `/etc/codex/skills/<skill_id>/` (if supported/allowed)

Optional advanced repo scopes (because Codex distinguishes them):

* `cwd` → `$PWD/.codex/skills/<skill_id>/`
* `parent` → `$PWD/../.codex/skills/<skill_id>/` ([OpenAI Developers][1])

### 7.4 `--agent vscode` / `--agent copilot` (GitHub Copilot Agent Skills)

GitHub docs + VS Code docs agree on:

* primary: `.github/skills/`

* legacy supported: `.claude/skills/` ([GitHub Docs][4])

* `repo` → `<project-root>/.github/skills/<skill_id>/`

* `repo --legacy` → `<project-root>/.claude/skills/<skill_id>/`

`user` scope: **unsupported** (docs state repo-level only “currently”). ([GitHub Docs][4])

### 7.5 `--agent amp`

Amp states skills install to `.agents/skills/` by default and also reads `~/.config/agents/skills/` (plus Claude-compatible locations for compatibility). ([AmpCode][5])

Portable-first mapping (default):

* `repo` → `<project-root>/.agents/skills/<skill_id>/`
* `user` → `${XDG_CONFIG_HOME:-~/.config}/agents/skills/<skill_id>/`

### 7.6 `--agent goose`

Goose documents a search order that includes both portable and goose-specific locations (global + project). ([Block][2])

Portable-first mapping (default):

* `repo` → `<project-root>/.agents/skills/<skill_id>/`
* `user` → `${XDG_CONFIG_HOME:-~/.config}/agents/skills/<skill_id>/`

If `--native` is provided:

* `repo` → `<project-root>/.goose/skills/<skill_id>/`
* `user` → `${XDG_CONFIG_HOME:-~/.config}/goose/skills/<skill_id>/` ([Block][2])

### 7.7 `--agent opencode`

OpenCode documents these locations (plus Claude-compatible ones it also searches). ([OpenCode][6])

* `repo` → `<project-root>/.opencode/skill/<skill_id>/`
* `user` → `${XDG_CONFIG_HOME:-~/.config}/opencode/skill/<skill_id>/`

### 7.8 `--agent factory` (Factory Droid CLI)

Factory docs specify workspace and personal roots. ([Factory Documentation][7])

* `repo` → `<project-root>/.factory/skills/<skill_id>/`
* `user` → `~/.factory/skills/<skill_id>/`

### 7.9 `--agent cursor` (best-effort; path not confirmed via first-party doc here)

* `repo` → `<project-root>/.cursor/skills/<skill_id>/`
* `user` → unsupported (until confirmed)

If you want to avoid this uncertainty, use `--agent vscode` (for Copilot) or `--agent portable`, which are documented.


## 8) Output conventions

* By default, `skill-install` should print human-readable status to **stderr**.
* With `--json`, print a single JSON object to **stdout**:

  * `agent`, `scope`, `skill_id`, `installed_to`, `mode`, `source` (path or stdin), `replaced` (bool)


## 9) Canonical workflows

### Install a bundled skill from a producer CLI into one agent (repo scope)

```bash
producer --skill tmux --export | skill-install --agent claude --scope repo
```

### Install into “portable” so multiple agents can read it

```bash
producer --skill api-setup --export | skill-install --agent portable --scope repo
```

### Install from a local directory into Codex user scope

```bash
skill-install ./skills/gh-actions-debug --agent codex --scope user
```


## 10) Escape hatches

### 10.1 Unknown agent/tool

If a tool isn’t listed, `skill-install` must support:

* `--dest <skills-root>` which installs to `<skills-root>/<skill_id>/...`

This keeps the spec future-proof without baking in every new agent.


[1]: https://developers.openai.com/codex/skills/ "Agent Skills"
[2]: https://block.github.io/goose/docs/guides/context-engineering/using-skills/ "Using Skills | goose"
[3]: https://code.claude.com/docs/en/skills "Agent Skills - Claude Code Docs"
[4]: https://docs.github.com/copilot/concepts/agents/about-agent-skills "About Agent Skills - GitHub Docs"
[5]: https://ampcode.com/news/agent-skills "Agent Skills - Amp"
[6]: https://opencode.ai/docs/skills/ "Agent Skills"
[7]: https://docs.factory.ai/cli/configuration/skills "Skills - Factory Documentation"
[8]: https://forum.cursor.com/t/adding-project-rules-becomes-skills-in-2-3-8/147499 "Adding project rules becomes skills in 2.3.8 - Bug Reports - Cursor - Community Forum"

