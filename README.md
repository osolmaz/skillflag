# skillflag

skillflag is a minimal CLI convention for listing and exporting agent skill bundles.

Spec: [Skillflag Specification](docs/SKILLFLAG_SPEC.md)

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

You can optionally install the skill to ~/.claude:

```
$ hue-cli --skill export philips-hue | npx skillflag install --agent claude --scope user
Installed skill philips-hue to ~/.claude/skills/philips-hue
```

Even better, once this convention becomes commonplace, agents will by default do all these before you even run the tool, so when you ask it to "install hue-cli", it will know to run `--skill list` the same way a human would run `--help` after downloading a program.

## Install (optional)

```bash
npm install -g skillflag
```

You can also run it without installing by using `npx` (see below).

skillflag is currently implemented in Node/TypeScript. Reach out if you'd like to see it implemented in other languages.

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
