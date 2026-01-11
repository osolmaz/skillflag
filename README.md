# skillflag

skillflag is a minimal CLI convention for listing and exporting agent skill bundles, plus a reference implementation in Node/TypeScript.

Spec: [Skillflag Specification](docs/SKILLFLAG_SPEC.md)

## Motivation

Think of skillflag as “`--help` for skills”: a stable flag-based interface to list and export bundled skills without tool‑specific install logic.

Agent skills are self-contained capability packages: a folder with a `SKILL.md` (name, description, instructions) plus any scripts, templates, and references the agent needs to execute a specific workflow. Tools list these skills, the agent loads one only when relevant, and installation is just placing the folder in a known skills directory.

## Install (optional)

```bash
npm install -g skillflag
```

You can also run it without installing by using `npx` (see below).

## Quick start

Any CLI that implements the skillflag convention can be used like this:

```bash
# list skills the tool can export
<tool> --skill list
# show a single skill’s metadata
<tool> --skill show <id>
# install into Codex user skills
<tool> --skill export <id> | npx skillflag install --agent codex
# install into Claude project skills
<tool> --skill export <id> | npx skillflag install --agent claude --scope repo
```

## Add skillflag to your CLI

1. Add the library and ship your skill directory in the package.
2. Add a `skills/<skill-id>/SKILL.md` in your repo.
3. In your CLI entrypoint, intercept `--skill` and delegate to skillflag.

```bash
npm install skillflag
```

```ts
import { findSkillsRoot, maybeHandleSkillflag } from "skillflag";

await maybeHandleSkillflag(process.argv, {
  skillsRoot: findSkillsRoot(import.meta.url),
});
```

See the full guide in [docs/INTEGRATION.md](docs/INTEGRATION.md).

## Bundled skill

This repo ships a single bundled skill at `skills/skillflag/` that documents both `skillflag` and `skill-install`.
