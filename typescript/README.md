# skillflag

Reference (TypeScript) implementation of the [Skillflag](https://github.com/osolmaz/skillflag) convention: a minimal CLI interface for bundling, listing, and installing [agent skills](https://agentskills.io) without a third-party registry.

This package ships:

- the embeddable producer library (`maybeHandleSkillflag`, `findSkillsRoot`),
- the standalone `skillflag` binary,
- the `skill-install` adaptor that installs exported skills into agent tools (Claude Code, Codex, Amp, Goose, and others).

## Install

```bash
npm install -g skillflag
# or run one-off with npx
npx skillflag list
```

## Embed in your CLI

```ts
import { findSkillsRoot, maybeHandleSkillflag } from "skillflag";

await maybeHandleSkillflag(process.argv, {
  skillsRoot: findSkillsRoot(import.meta.url),
});
```

Then ship a `skills/<skill-id>/SKILL.md` directory in your package. Users install your skill with:

```bash
your-tool --skill export <id> | npx skillflag install --agent claude --scope repo
```

## Documentation

- [Skillflag specification](https://github.com/osolmaz/skillflag/blob/main/docs/SKILLFLAG_SPEC.md)
- [Integration guide](https://github.com/osolmaz/skillflag/blob/main/docs/INTEGRATION.md)

Go, Python, and Rust implementations of the same standard live in the [same repository](https://github.com/osolmaz/skillflag).

## License

[MIT](LICENSE)
