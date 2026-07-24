# skillflag-py

Python implementation of the [Skillflag](https://github.com/osolmaz/skillflag) convention: a minimal CLI interface for bundling, listing, and installing [agent skills](https://agentskills.io) without a third-party registry.

This package ships:

- the embeddable producer library (`skillflag.maybe_handle_skillflag`, `skillflag.find_skills_root`),
- the standalone `skillflag-py` binary,
- the `skill-install-py` adaptor that installs exported skills into agent tools (Claude Code, Codex, Amp, Goose, and others).

Exports are byte-identical to the other Skillflag implementations (TypeScript, Go, Rust) — any producer can be paired with any installer.

## Install

```bash
uv tool install skillflag-py
# or run one-off
uvx --from skillflag-py skillflag-py list
```

## Embed in your CLI

```python
import sys

from skillflag import SkillflagOptions, find_skills_root, maybe_handle_skillflag

maybe_handle_skillflag(
    sys.argv,
    SkillflagOptions(skills_root=find_skills_root(__file__)),
)
```

Then ship a `skills/<skill-id>/SKILL.md` directory in your package. Users install your skill with:

```bash
your-tool --skill export <id> | skill-install-py --agent claude --scope repo
```

## Documentation

- [Skillflag specification](https://github.com/osolmaz/skillflag/blob/main/docs/SKILLFLAG_SPEC.md)
- [Integration guide](https://github.com/osolmaz/skillflag/blob/main/docs/INTEGRATION.md)

## Development

```bash
cd python
uv sync
uv run ruff format --check . && uv run ruff check . && uv run pytest
```

## License

[MIT](https://github.com/osolmaz/skillflag/blob/main/LICENSE)
