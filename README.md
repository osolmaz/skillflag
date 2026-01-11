# Skillflag

Skillflag is a minimal CLI convention for listing and exporting agent skill bundles, plus a reference implementation in Node/TypeScript.

Spec: [Skillflag Specification](docs/SKILLFLAG_SPEC.md)

## Motivation

Think of Skillflag as “`--help` for skills”: a stable flag-based interface to list and export bundled skills without tool‑specific install logic.

AgentSkills ([agentskills.io](https://agentskills.io)) frames the underlying concept well: “Agent Skills are folders of instructions, scripts, and resources that agents can discover and use to do things more accurately and efficiently.”

## Install

```bash
npm install -g skillflag
```

## Quick start

List bundled skills:

```bash
skillflag --skill list
```

Export a skill bundle:

```bash
skillflag --skill export skillflag > skillflag.tar
```

Install a skill into Codex or Claude Code (repo scope):

```bash
skillflag --skill export skillflag | skill-install --agent codex --scope repo
skillflag --skill export skillflag | skill-install --agent claude --scope repo
skillflag install --agent codex --scope repo ./skills/skillflag
```

## Using without global install

From the repo root:

```bash
npm run build
node dist/bin/skillflag.js --skill list
node dist/bin/skillflag.js install --agent claude --scope repo ./skills/skillflag
```

## Bundled skill

This repo ships a single bundled skill at `skills/skillflag/` that documents both `skillflag` and `skill-install`.
