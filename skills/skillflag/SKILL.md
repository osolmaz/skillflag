---
name: skillflag
description: Use Skillflag producer and installer CLIs (skillflag + skill-install).
---

# Skillflag + skill-install

This skill documents how to use the Skillflag producer CLI (`skillflag`) and the installer CLI (`skill-install`).

## What this repo provides

- `skillflag --skill list` lists bundled skill IDs
- `skillflag --skill export <id>` exports a skill bundle as a tar stream
- `skill-install` consumes a skill directory or tar stream and installs it into a target agent scope

## Quick start

List skills:

```
skillflag --skill list
```

Export the bundled skill and install into Codex repo scope:

```
skillflag --skill export skillflag | skill-install --agent codex --scope repo
```

Export the bundled skill and install into Claude repo scope:

```
skillflag --skill export skillflag | skill-install --agent claude --scope repo
```

## skill-install inputs

Directory input:

```
skill-install ./skills/skillflag --agent codex --scope repo
```

Tar stream input (from producer):

```
skillflag --skill export skillflag | skill-install --agent codex --scope repo
```

## Notes

- `skillflag` is the producer interface; it never installs.
- `skill-install` validates `SKILL.md` frontmatter and installs by copy.
- The full specification lives at `docs/SKILLFLAG_SPEC.md`.

## Spec essentials (producer)

- Producer CLIs MUST implement:
  - `--skill list`
  - `--skill export <id>`
- `--skill list` writes only skill IDs to stdout (no banners).
- `--skill export <id>` streams a tar with a single top‑level `<id>/` and `<id>/SKILL.md`.
- Export output MUST be deterministic: sorted entries, fixed `mtime = 0`, `uid/gid = 0`.

## Adding Skillflag to a Node CLI (library integration)

Early‑intercept in your CLI entrypoint so stdout stays clean:

```ts
// src/bin/cli.ts
import process from "node:process";
import { handleSkillflag } from "@osolmaz/skillflag";

const args = process.argv;
if (args.includes("--skill")) {
  const exitCode = await handleSkillflag(args, {
    skillsRoot: new URL("../skills/", import.meta.url),
  });
  process.exitCode = exitCode;
  return;
}

// ... normal CLI startup here
```

Repository layout (bundled skills):

```
skills/
  my-skill/
    SKILL.md
    templates/...
```
