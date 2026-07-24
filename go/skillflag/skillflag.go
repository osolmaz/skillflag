// Package skillflag implements the Skillflag producer convention
// (docs/SKILLFLAG_SPEC.md) as an embeddable library: `--skill list`,
// `--skill export <id>`, `--skill show <id>`, `--skill help`, and the
// `--skill install` convenience that delegates to the installer.
package skillflag

import (
	"bufio"
	"bytes"
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/osolmaz/skillflag/go/internal/core"
	"github.com/osolmaz/skillflag/go/internal/install"
)

//go:embed skills
var bundledSkillsFS embed.FS

// Options configures Handle and MaybeHandle.
type Options struct {
	// SkillsRoots are producer skills roots, in precedence order (first
	// root wins on duplicate skill ids).
	SkillsRoots []string
	// IncludeBundledSkill controls whether the bundled `skillflag` skill is
	// appended as the last (lowest precedence) root. Defaults to true.
	IncludeBundledSkill *bool
	// Stdin/Stdout/Stderr default to the process streams.
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
	// Cwd is used for the installer (git repo root discovery, cwd scope)
	// and to resolve relative skills roots. Defaults to the process cwd.
	Cwd string
	// StdinIsTTY overrides TTY detection (for tests).
	StdinIsTTY *bool
}

// Bool is a convenience for building *bool option values.
func Bool(v bool) *bool { return &v }

type skillAction struct {
	kind        string // "install", "list", "export", "show", "help"
	id          string
	json        bool
	ids         []string
	installArgs []string
}

var usageText = strings.Join([]string{
	"Usage:",
	"  --skill install [<id> ...] [--agent <agent>] [--scope <scope>] [--force]",
	"  --skill list [--json]",
	"  --skill export <id>",
	"  --skill show <id>",
	"  --skill help",
}, "\n")

// HelpText is the output of `--skill help`.
var HelpText = strings.Join([]string{
	"Skillflag help",
	"",
	"Install skillflag globally to get both binaries on your PATH:",
	"  npm install -g skillflag",
	"",
	"Prefer not to install globally? Use npx for one-off runs:",
	"  npx skillflag list",
	"  npx skillflag install --agent codex --scope repo < ./skill.tar",
	"",
	"List available skills:",
	"  tool --skill list",
	"  tool --skill list --json",
	"",
	"Show a skill's documentation:",
	"  tool --skill show <id>",
	"",
	"Export a skill bundle:",
	"  tool --skill export <id>",
	"",
	"Install a skill bundle:",
	"  tool --skill install [<id> ...] [--agent <agent>] [--scope <scope>]",
	"  tool --skill export <id> | skill-install --agent <agent> --scope <scope>",
	"",
	"For full details, read docs/SKILLFLAG_SPEC.md.",
}, "\n")

// FindSkillsRoot walks upward from start looking for a skills/ then
// .agents/skills/ directory and returns the first match.
func FindSkillsRoot(start string) (string, error) {
	return core.FindSkillsRoot(start)
}

// FindSkillsRoots walks upward from start and returns every producer skills
// root (skills/, .agents/skills/) found in the first ancestor that has any.
func FindSkillsRoots(start string) ([]string, error) {
	return core.FindSkillsRoots(start)
}

func bundledRoot() core.Root {
	sub, err := fs.Sub(bundledSkillsFS, "skills")
	if err != nil {
		// The embedded tree always contains "skills"; this is unreachable.
		panic(err)
	}
	return core.Root{FS: sub, Key: "\x00bundled-skillflag", NormalizeModes: true}
}

func uniqueStrings(values []string) []string {
	var out []string
	for _, value := range values {
		found := false
		for _, existing := range out {
			if existing == value {
				found = true
				break
			}
		}
		if !found {
			out = append(out, value)
		}
	}
	return out
}

func parseInstallIDs(values []string) ([]string, []string) {
	var ids []string
	index := 0
	for index < len(values) {
		value := values[index]
		if strings.HasPrefix(value, "-") {
			break
		}
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				ids = append(ids, part)
			}
		}
		index++
	}
	return uniqueStrings(ids), values[index:]
}

// parseSkillArgs parses the action from argv. argv[0] is the program name
// (os.Args style); if a `--skill` token is present the action starts right
// after it, otherwise argv[1] is the action (standalone binary form).
func parseSkillArgs(argv []string) (skillAction, error) {
	cliArgs := argv
	if len(argv) > 0 {
		cliArgs = argv[1:]
	}
	args := cliArgs
	for i, arg := range cliArgs {
		if arg == "--skill" {
			args = cliArgs[i+1:]
			break
		}
	}

	if len(args) == 0 || args[0] == "" || strings.HasPrefix(args[0], "-") {
		return skillAction{}, fmt.Errorf("Missing --skill action.\n%s", usageText)
	}
	action := args[0]

	switch action {
	case "install":
		ids, installArgs := parseInstallIDs(args[1:])
		return skillAction{kind: "install", ids: ids, installArgs: installArgs}, nil
	case "list":
		json := false
		for _, arg := range args[1:] {
			if arg == "--json" {
				json = true
			}
		}
		return skillAction{kind: "list", json: json}, nil
	case "help":
		return skillAction{kind: "help"}, nil
	case "export", "show":
		if len(args) < 2 || args[1] == "" || strings.HasPrefix(args[1], "-") {
			return skillAction{}, fmt.Errorf("Missing skill id.\n%s", usageText)
		}
		return skillAction{kind: action, id: args[1]}, nil
	}

	return skillAction{}, fmt.Errorf("Unknown --skill action: %s.\n%s", action, usageText)
}

func resolveRoots(opts Options) []core.Root {
	var roots []core.Root
	seen := map[string]bool{}
	for _, root := range opts.SkillsRoots {
		abs := absAgainst(root, opts.Cwd)
		if !seen[abs] {
			seen[abs] = true
			roots = append(roots, core.DiskRoot(abs))
		}
	}
	if opts.IncludeBundledSkill == nil || *opts.IncludeBundledSkill {
		roots = append(roots, bundledRoot())
	}
	return roots
}

func absAgainst(path string, cwd string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	if cwd != "" {
		return filepath.Join(cwd, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	return abs
}

func stdinIsTTY(stdin io.Reader, override *bool) bool {
	if override != nil {
		return *override
	}
	file, ok := stdin.(*os.File)
	if !ok {
		return false
	}
	info, err := file.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func promptSkillIDs(skills []core.SkillInfo, stdin io.Reader, stderr io.Writer) ([]string, error) {
	fmt.Fprintln(stderr, "Select skills to install:")
	for i, skill := range skills {
		if skill.Summary != "" {
			fmt.Fprintf(stderr, "  %d. %s\t%s\n", i+1, skill.ID, skill.Summary)
		} else {
			fmt.Fprintf(stderr, "  %d. %s\n", i+1, skill.ID)
		}
	}
	fmt.Fprint(stderr, "Skills (comma-separated numbers or ids): ")

	reader := bufio.NewReader(stdin)
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return nil, errors.New("Install cancelled.")
	}

	var ids []string
	for _, token := range strings.Split(strings.TrimSpace(line), ",") {
		token = strings.TrimSpace(token)
		if token == "" {
			continue
		}
		if n, convErr := strconv.Atoi(token); convErr == nil {
			if n < 1 || n > len(skills) {
				return nil, fmt.Errorf("Invalid selection: %s", token)
			}
			ids = append(ids, skills[n-1].ID)
			continue
		}
		found := false
		for _, skill := range skills {
			if skill.ID == token {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("Invalid selection: %s", token)
		}
		ids = append(ids, token)
	}
	if len(ids) == 0 {
		return nil, errors.New("Install cancelled.")
	}
	return uniqueStrings(ids), nil
}

func resolveInstallSkillIDs(
	action skillAction,
	roots []core.Root,
	stdin io.Reader,
	stderr io.Writer,
	tty bool,
) ([]string, error) {
	if len(action.ids) > 0 {
		return action.ids, nil
	}

	skills := core.ListSkills(roots)
	if len(skills) == 0 {
		return nil, errors.New("No skills are available to install.")
	}
	if len(skills) == 1 {
		return []string{skills[0].ID}, nil
	}
	if !tty {
		return nil, errors.New(
			"Multiple skills are available; pass one or more ids with --skill install <id> [...].",
		)
	}
	return promptSkillIDs(skills, stdin, stderr)
}

func runInstallAction(
	action skillAction,
	roots []core.Root,
	opts Options,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
) (int, error) {
	tty := stdinIsTTY(stdin, opts.StdinIsTTY)
	skillIDs, err := resolveInstallSkillIDs(action, roots, stdin, stderr, tty)
	if err != nil {
		return 0, err
	}

	inputs := make([]install.Input, 0, len(skillIDs))
	for _, skillID := range skillIDs {
		skillFS, normalize, resolveErr := core.ResolveSkillFS(roots, skillID)
		if resolveErr != nil {
			return 0, resolveErr
		}
		var buf bytes.Buffer
		if exportErr := core.ExportSkill(skillFS, skillID, normalize, &buf); exportErr != nil {
			return 0, exportErr
		}
		inputs = append(inputs, install.Input{Tar: buf.Bytes()})
	}

	code := install.RunCLI(action.installArgs, install.CLIOptions{
		Stdin:            stdin,
		Stdout:           stdout,
		Stderr:           stderr,
		Cwd:              opts.Cwd,
		ProvidedInputs:   inputs,
		ProvidedSkillIDs: skillIDs,
		StdinIsTTY:       opts.StdinIsTTY,
	})
	return code, nil
}

// Handle runs the skillflag action found in argv and returns the process
// exit code. argv follows os.Args conventions (argv[0] is the program name).
func Handle(argv []string, opts Options) int {
	stdin := opts.Stdin
	if stdin == nil {
		stdin = os.Stdin
	}
	stdout := opts.Stdout
	if stdout == nil {
		stdout = os.Stdout
	}
	stderr := opts.Stderr
	if stderr == nil {
		stderr = os.Stderr
	}

	code, err := handle(argv, opts, stdin, stdout, stderr)
	if err != nil {
		fmt.Fprintf(stderr, "%s\n", err)
		return 1
	}
	return code
}

func handle(
	argv []string,
	opts Options,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
) (int, error) {
	action, err := parseSkillArgs(argv)
	if err != nil {
		return 0, err
	}
	roots := resolveRoots(opts)

	switch action.kind {
	case "install":
		return runInstallAction(action, roots, opts, stdin, stdout, stderr)

	case "list":
		if action.json {
			payload, listErr := core.ListSkillsJSON(roots)
			if listErr != nil {
				return 0, listErr
			}
			data, marshalErr := core.MarshalListJSON(payload)
			if marshalErr != nil {
				return 0, marshalErr
			}
			if _, writeErr := stdout.Write(data); writeErr != nil {
				return 0, writeErr
			}
			return 0, nil
		}
		skills := core.ListSkills(roots)
		if len(skills) > 0 {
			lines := make([]string, 0, len(skills))
			for _, skill := range skills {
				if skill.Summary != "" {
					lines = append(lines, skill.ID+"\t"+skill.Summary)
				} else {
					lines = append(lines, skill.ID)
				}
			}
			if _, writeErr := io.WriteString(stdout, strings.Join(lines, "\n")+"\n"); writeErr != nil {
				return 0, writeErr
			}
		}
		return 0, nil

	case "export":
		skillFS, normalize, resolveErr := core.ResolveSkillFS(roots, action.id)
		if resolveErr != nil {
			return 0, resolveErr
		}
		return 0, core.ExportSkill(skillFS, action.id, normalize, stdout)

	case "help":
		_, writeErr := io.WriteString(stdout, HelpText+"\n")
		return 0, writeErr

	default: // "show"
		skillFS, _, resolveErr := core.ResolveSkillFS(roots, action.id)
		if resolveErr != nil {
			return 0, resolveErr
		}
		return 0, core.ShowSkill(skillFS, stdout)
	}
}

// MaybeHandle handles argv only when it contains a `--skill` token. It
// returns (false, 0) and does nothing otherwise.
func MaybeHandle(argv []string, opts Options) (bool, int) {
	found := false
	for _, arg := range argv {
		if arg == "--skill" {
			found = true
			break
		}
	}
	if !found {
		return false, 0
	}
	return true, Handle(argv, opts)
}
