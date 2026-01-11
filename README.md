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

List bundled skills:

```bash
npx <tool> --skill list
```

Export a skill bundle:

```bash
npx <tool> --skill export <id> > skill.tar
```

Install a skill into Codex or Claude Code (repo scope):

```bash
npx <tool> install --agent codex --scope repo ./skills/<id>
npx <tool> install --agent claude --scope repo ./skills/<id>
npx <tool> --skill export <id> | skill-install --agent codex --scope repo
npx <tool> --skill export <id> | skill-install --agent claude --scope repo
```

## Install (optional)

If you want `skillflag` and `skill-install` on your PATH:

```bash
npm install -g skillflag
```

## Bundled skill

This repo ships a single bundled skill at `skills/skillflag/` that documents both `skillflag` and `skill-install`.
