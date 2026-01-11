# Skillflag

Skillflag is a minimal CLI convention for listing and exporting agent skill bundles, plus a reference implementation in Node/TypeScript.

Spec: [Skillflag Specification](docs/SKILLFLAG_SPEC.md)

## Motivation

Think of Skillflag as “`--help` for skills”: a stable flag-based interface to list and export bundled skills without tool‑specific install logic.

AgentSkills ([agentskills.io](https://agentskills.io)) frames the underlying concept well: “Agent Skills are folders of instructions, scripts, and resources that agents can discover and use to do things more accurately and efficiently.”

## Install (optional)

```bash
npm install -g skillflag
```

You can also run it without installing by using `npx` (see below).

## Quick start

Any CLI that implements the Skillflag convention can be used like this:

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

## Add Skillflag to your CLI

1. Add the library and ship your skill directory in the package.
2. Add a `skills/<skill-id>/SKILL.md` in your repo.
3. In your CLI entrypoint, intercept `--skill` and delegate to Skillflag.

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
