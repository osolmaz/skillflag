# Integrating Skillflag into your CLI

This guide shows how to expose `--skill` in your own CLI using the Skillflag library. The goal is to keep your tool **agent-agnostic**: you only list/export skills, while users install them with `skillflag install` (or any compatible installer).

## 1) Add a skills directory

Create a directory in your repo that will ship with your package, for example:

```
skills/
  my-skill/
    SKILL.md
    scripts/
```

Your `SKILL.md` must include frontmatter with `name` and `description` per the spec. Example:

```markdown
---
name: my-skill
description: Helps with deployment checks and release tagging.
---

# My Skill

Usage, scripts, references...
```

## 2) Make sure skills are bundled

Ensure the `skills/` directory is included in your published package. For npm:

```json
{
  "files": ["dist", "skills", "README.md", "LICENSE"]
}
```

If you publish via a different mechanism, just make sure the skill directory ships alongside your built CLI output.

## 3) Wire `--skill` early in your CLI

Intercept `--skill` before your regular CLI parsing so Skillflag can take over. Example:

```ts
import { handleSkillflag } from "skillflag";

if (process.argv.includes("--skill")) {
  const exitCode = await handleSkillflag(process.argv, {
    skillsRoot: new URL("../skills/", import.meta.url),
    // includeBundledSkill: false, // set to false to exclude skillflag's bundled skill
  });
  process.exit(exitCode);
}
```

**Choosing `skillsRoot`:** point it at the packaged `skills/` directory. If your compiled CLI lives in `dist/bin/`, you may need something like:

```ts
skillsRoot: new URL("../../skills/", import.meta.url);
```

Adjust this path for your build layout.

## 4) Try it locally

```bash
<tool> --skill list
<tool> --skill show my-skill
<tool> --skill export my-skill | npx skillflag install --agent codex
```

That is all you need for a conforming producer CLI.

## Tips

- If you want to test without process exit, pass custom `stdout`/`stderr` streams to `handleSkillflag`.
- Skillflag only expects to **list** and **export** skills. Avoid embedding installer logic in your CLI.
