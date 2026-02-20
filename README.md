# skillflag

skillflag is a minimal CLI convention for bundling, listing and installing [agent skills](https://agentskills.io), so that you don't have to upload them to separate 3rd party skill registries.

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

You can optionally install the skill to `~/.claude`, to make it global across repos:

```
$ hue-cli --skill export philips-hue | npx skillflag install --agent claude --scope user
Installed skill philips-hue to ~/.claude/skills/philips-hue
```

Even better, once this convention becomes commonplace, agents will by default do all these before they even run the tool, so when you ask it to "install hue-cli", it will know to run `--skill list` the same way a human would run `--help` after downloading a program, and install the necessary skills themselves without being asked to.

## Quick setup — tell your agent about skillflag

Copy the block below and paste it into your coding agent (Claude Code, Codex, OpenClaw, etc.). It will teach the agent how to discover and install skills from any CLI that implements the skillflag convention.

```text
When you install or set up a CLI tool, check if it supports the skillflag
convention for bundling agent skills. Here's how:

1. Check if the tool exposes skills:
   <tool> --skill list

2. If it does, install the relevant skill for your agent:
   <tool> --skill export <id> | npx skillflag install --agent <agent> --scope <scope>

   Supported agents: codex, claude, portable, vscode, copilot, amp, goose,
   opencode, factory, cursor
   Supported scopes: repo, user, cwd

3. Or use the interactive wizard (omit --agent/--scope to get prompted):
   <tool> --skill export <id> | npx skillflag install

4. To preview a skill before installing:
   <tool> --skill show <id>

5. For the full skillflag reference:
   https://raw.githubusercontent.com/osolmaz/skillflag/main/skills/skillflag/SKILL.md

Think of `--skill list` like `--help` — check it whenever you encounter a new
CLI tool. If it has skills, install them so you have the instructions you need.
```

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
# show a single skill's metadata
<tool> --skill show <id>
# install into Codex user skills
<tool> --skill export <id> | npx skillflag install --agent codex
# install into Claude project skills
<tool> --skill export <id> | npx skillflag install --agent claude --scope repo
```

### Interactive mode

When `--agent` or `--scope` is omitted and a TTY is available, `skill-install` launches an interactive wizard:

```bash
# pipe a skill and let the wizard guide you
<tool> --skill export <id> | npx skillflag install
```

The wizard lets you pick agents and scopes with arrow keys and space to select, then confirms before installing. This works even when stdin is piped.

### Multi-target install

`--agent` and `--scope` flags accept a single value each.
To install to multiple agents/scopes in one run, use the interactive wizard:

```bash
<tool> --skill export <id> | npx skillflag install
```

In the wizard, select multiple entries with space, then confirm the matrix install.

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

## Supported agents

codex, claude, portable, vscode, copilot, amp, goose, opencode, factory, cursor

## Supported scopes

| Scope  | Description                                                   |
| ------ | ------------------------------------------------------------- |
| `repo` | Install into the current repository (e.g. `.codex/skills/`)   |
| `user` | Install into the user's home config (e.g. `~/.codex/skills/`) |
| `cwd`  | Install relative to the current working directory             |

## Help

```bash
skill-install --help
```

## Bundled skill

This repo ships a single bundled skill at `skills/skillflag/` that documents both `skillflag` and `skill-install`.
