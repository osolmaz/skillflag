# Deterministic tar format (implementation contract)

Every Skillflag implementation in this repository must produce **byte-identical**
export streams for the same on-disk skill directory. The `digest` field in
`--skill list --json` is `sha256:` over exactly these bytes, so any deviation
breaks cross-implementation integrity verification. The conformance suite
(`scripts/check-conformance.mjs`) compares the raw bytes across all
implementations.

This document pins down the byte layout the reference (TypeScript)
implementation emits. The spec (`docs/SKILLFLAG_SPEC.md` §9) allows any
POSIX-compatible deterministic tar; this repo's implementations additionally
commit to the exact layout below.

## Entry set and ordering

- Walk the skill directory recursively.
- Emit one entry per **directory** (including the skill root) and one per
  **regular file**. Symlinks, hardlinks, and special files are errors.
- Directory entry names end with `/`: the root is `<id>/`, nested directories
  are `<id>/<rel>/`. File entries are `<id>/<rel>` with forward slashes.
- Sort all entries (directories and files together) by entry name using
  **byte-wise lexicographic comparison** of the name including any trailing
  `/`. Do not use locale-aware collation.
- Reject absolute paths and any path containing a `..` segment.

## Header block (512 bytes, POSIX ustar)

All unspecified bytes are `0x00`. Numeric fields use ASCII octal digits,
zero-padded on the left.

| Offset | Len | Field    | Value |
| ------ | --- | -------- | ----- |
| 0      | 100 | name     | entry name, NUL padded. Names longer than 100 bytes are an error (the reference implementation would switch to PAX; skills must keep paths short). |
| 100    | 8   | mode     | 6 octal digits + space + NUL, e.g. `000644 \0`. Value is the on-disk mode masked with `0o777` (execute bits preserved), for both files and directories. |
| 108    | 8   | uid      | `000000 \0` |
| 116    | 8   | gid      | `000000 \0` |
| 124    | 12  | size     | 11 octal digits + space, e.g. `00000000077 `. Directories use size 0. |
| 136    | 12  | mtime    | `00000000000 ` (fixed epoch 0) |
| 148    | 8   | chksum   | 6 octal digits + space + NUL. Sum of all header bytes with this field treated as 8 spaces (`0x20`). |
| 156    | 1   | typeflag | `0` for files, `5` for directories |
| 157    | 100 | linkname | all NUL |
| 257    | 6   | magic    | `ustar\0` |
| 263    | 2   | version  | `00` |
| 265    | 32  | uname    | all NUL (empty string) |
| 297    | 32  | gname    | all NUL (empty string) |
| 329    | 8   | devmajor | `000000 \0` |
| 337    | 8   | devminor | `000000 \0` |
| 345    | 155 | prefix   | all NUL |
| 500    | 12  | padding  | all NUL |

Note the quirks inherited from the reference implementation: `size` and
`mtime` end with a space and **no** NUL; `mode`/`uid`/`gid`/`chksum`/
`devmajor`/`devminor` end with a space **and** a NUL; `devmajor`/`devminor`
are written as zeros even for regular files and directories (GNU tar leaves
them blank).

## Data and stream trailer

- File contents follow each file header, NUL-padded to a 512-byte boundary.
- Directory entries have no data.
- The stream ends with exactly **two** 512-byte zero blocks. There is no
  additional blocking-factor padding (total stream length is a multiple of
  512, not necessarily of 10240).

## Digest

`sha256:` + lowercase hex SHA-256 over the entire stream described above,
including the two trailer blocks.

## Worked example

For `fixtures/skills/alpha` (SKILL.md of 63 bytes, `templates/hello.txt` of
6 bytes) the stream is 8 blocks (4096 bytes): headers for `alpha/`,
`alpha/SKILL.md` + 1 data block, `alpha/templates/` and
`alpha/templates/hello.txt` + 1 data block, then 2 zero blocks. Verify any
implementation against the reference with:

```bash
cd typescript && npm ci && npm run build
node --input-type=module -e '
import { handleSkillflag } from "./dist/index.js";
import fs from "node:fs";
const out = fs.createWriteStream("/tmp/ref.tar");
await handleSkillflag(["node", "x", "--skill", "export", "alpha"], {
  skillsRoot: "../fixtures/skills",
  stdout: out,
  includeBundledSkill: false,
});
await new Promise((r) => out.end(r));
'
cmp /tmp/ref.tar /tmp/yours.tar
```

Digests are stable per checkout but **not** across machines with different
umasks, because on-disk modes flow into the headers. Conformance therefore
compares implementations against each other at runtime instead of pinning
expected digests in the repository.
