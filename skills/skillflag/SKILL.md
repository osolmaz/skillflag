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
- See the repository README for the full specification.
