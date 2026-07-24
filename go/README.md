# skillflag (Go)

Go implementation of the [Skillflag](https://github.com/osolmaz/skillflag) convention: a minimal CLI interface for bundling, listing, and installing [agent skills](https://agentskills.io) without a third-party registry.

This module ships:

- the embeddable producer package `github.com/osolmaz/skillflag/go/skillflag` (`MaybeHandle`, `FindSkillsRoot`),
- the standalone `skillflag-go` binary,
- the `skill-install-go` adaptor that installs exported skills into agent tools (Claude Code, Codex, Amp, Goose, and others).

Exports are byte-identical to the other Skillflag implementations (TypeScript, Python, Rust) — any producer can be paired with any installer. The module has zero third-party dependencies.

## Install

```bash
go install github.com/osolmaz/skillflag/go/cmd/skillflag-go@latest
go install github.com/osolmaz/skillflag/go/cmd/skill-install-go@latest
```

## Embed in your CLI

```go
package main

import (
	"os"

	"github.com/osolmaz/skillflag/go/skillflag"
)

func main() {
	root, err := skillflag.FindSkillsRoot(".")
	if err == nil {
		if handled, code := skillflag.MaybeHandle(os.Args, skillflag.Options{
			SkillsRoots: []string{root},
		}); handled {
			os.Exit(code)
		}
	}
	// ... your CLI ...
}
```

Then ship a `skills/<skill-id>/SKILL.md` directory with your tool. Users install your skill with:

```bash
your-tool --skill export <id> | skill-install-go --agent claude --scope repo
```

## Documentation

- [Skillflag specification](https://github.com/osolmaz/skillflag/blob/main/docs/SKILLFLAG_SPEC.md)
- [Integration guide](https://github.com/osolmaz/skillflag/blob/main/docs/INTEGRATION.md)

## Development

```bash
cd go
gofmt -l .
GOWORK=off go vet ./...
GOWORK=off go test ./...
```

## License

[MIT](https://github.com/osolmaz/skillflag/blob/main/LICENSE)
