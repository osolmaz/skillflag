# skillflag-rs

Rust implementation of the [Skillflag](https://github.com/osolmaz/skillflag) convention: a minimal CLI interface for bundling, listing, and installing [agent skills](https://agentskills.io) without a third-party registry.

The `skillflag-rs` crate ships:

- the embeddable producer library (`skillflag::maybe_handle_skillflag`, `skillflag::find_skills_root`),
- the standalone `skillflag-rs` binary,
- the `skill-install-rs` adaptor that installs exported skills into agent tools (Claude Code, Codex, Amp, Goose, and others).

Exports are byte-identical to the other Skillflag implementations (TypeScript, Go, Python) — any producer can be paired with any installer. The only dependency is `sha2`.

## Install

```bash
cargo install skillflag-rs --locked
```

## Embed in your CLI

```rust
use skillflag::{find_skills_root, maybe_handle_skillflag, Options};

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    if let Ok(root) = find_skills_root(env!("CARGO_MANIFEST_DIR")) {
        let opts = Options {
            skills_roots: vec![root],
            ..Options::default()
        };
        if let Some(code) = maybe_handle_skillflag(&argv, &opts) {
            std::process::exit(code);
        }
    }
    // ... your CLI ...
}
```

Then ship a `skills/<skill-id>/SKILL.md` directory with your tool. Users install your skill with:

```bash
your-tool --skill export <id> | skill-install-rs --agent claude --scope repo
```

## Documentation

- [Skillflag specification](https://github.com/osolmaz/skillflag/blob/main/docs/SKILLFLAG_SPEC.md)
- [Integration guide](https://github.com/osolmaz/skillflag/blob/main/docs/INTEGRATION.md)

## Development

```bash
cd rust
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test
```

## License

[MIT](https://github.com/osolmaz/skillflag/blob/main/LICENSE)
