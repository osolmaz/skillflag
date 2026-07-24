# Integrating Skillflag into your CLI

This guide shows how to expose `--skill` in your own CLI using the Skillflag library. The goal is to keep your tool **agent-agnostic**: you only list/export skills, while users install them with `skillflag install` (or any compatible installer).

The code examples below use the TypeScript reference implementation (npm `skillflag`). The Go (`github.com/osolmaz/skillflag/go`), Python (`skillflag`), and Rust (`skillflag`) libraries in this repository expose the same producer entry points under idiomatic names — see each package's README.

## 1) Add a skills directory

Create a directory in your repo that will ship with your package, for example:

```
skills/
  my-skill/
    SKILL.md
    scripts/
```

Portable repo-local agent skills are also supported:

```
.agents/
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

Ensure the `skills/` or `.agents/skills/` directory is included in your published package. For npm:

```json
{
  "files": ["dist", "skills", ".agents/skills", "README.md", "LICENSE"]
}
```

If you publish via a different mechanism, just make sure the skill directory ships alongside your built CLI output.

### OpenClaw plugin packages

OpenClaw plugins can already declare packaged skills in `openclaw.plugin.json`.
If your plugin also exposes a user-facing CLI, Skillflag can export the same
skills to Codex, Claude, Goose, and other agents without adding agent-specific
install paths to the plugin itself.

Using `@xquik/tweetclaw` as an example, keep the skill folder in the published
package and declare it in the plugin manifest:

```json
{
  "name": "@xquik/tweetclaw",
  "files": ["dist/", "skills/tweetclaw/", "openclaw.plugin.json"]
}
```

```json
{
  "id": "tweetclaw",
  "skills": ["skills/tweetclaw"]
}
```

For a CLI-enabled plugin, point the CLI entrypoint at the package's `skills/`
directory:

```ts
import { findSkillsRoot, maybeHandleSkillflag } from "skillflag";

await maybeHandleSkillflag(process.argv, {
  includeBundledSkill: false,
  skillsRoot: findSkillsRoot(import.meta.url),
});
```

This keeps OpenClaw installation native:

```bash
openclaw plugins install npm:@xquik/tweetclaw
```

After the package wires that entrypoint to a `tweetclaw` bin, users also get a
portable skill export path for non-OpenClaw agents:

```bash
tweetclaw --skill list
tweetclaw --skill export tweetclaw | npx skillflag install --agent codex
```

Xquik is an independent third-party service. Not affiliated with X Corp.
"Twitter" and "X" are trademarks of X Corp.

## 3) Wire `--skill` early in your CLI

Intercept `--skill` before your regular CLI parsing so Skillflag can take over. Example (ESM):

```ts
import { findSkillsRoot, maybeHandleSkillflag } from "skillflag";

await maybeHandleSkillflag(process.argv, {
  skillsRoot: findSkillsRoot(import.meta.url),
  // includeBundledSkill: false, // set to false to exclude skillflag's bundled skill
});
```

Example (CommonJS):

```ts
const { findSkillsRoot, maybeHandleSkillflag } = require("skillflag");

await maybeHandleSkillflag(process.argv, {
  skillsRoot: findSkillsRoot(__dirname),
});
```

`findSkillsRoot()` walks upward from the given file/dir until it finds a `skills/` or `.agents/skills/` directory, so you don't need to hardcode build offsets. It prefers `skills/` when both exist. Use `findSkillsRoots()` if you intentionally ship both roots. If you prefer to be explicit, you can still pass a URL, path, or array of roots directly.

## 4) Try it locally

```bash
<tool> --skill list
<tool> --skill show my-skill
<tool> --skill export my-skill | npx skillflag install --agent codex
```

That is all you need for a conforming producer CLI.

## Tips

- If you want to avoid `process.exit`, call `maybeHandleSkillflag(..., { exit: false })` and handle the return value.
- If you want to test without process exit, pass custom `stdout`/`stderr` streams to `handleSkillflag`.
- Skillflag only expects to **list** and **export** skills. Avoid embedding installer logic in your CLI.
