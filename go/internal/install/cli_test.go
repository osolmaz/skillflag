package install

import (
	"archive/tar"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/osolmaz/skillflag/go/internal/core"
)

type cliResult struct {
	code   int
	stdout *bytes.Buffer
	stderr *bytes.Buffer
}

func runCLITest(args []string, opts CLIOptions) cliResult {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	opts.Stdout = stdout
	opts.Stderr = stderr
	if opts.Stdin == nil {
		opts.Stdin = bytes.NewReader(nil)
	}
	code := RunCLI(args, opts)
	return cliResult{code: code, stdout: stdout, stderr: stderr}
}

func writeSkill(t *testing.T, dir string, name string, description string) string {
	t.Helper()
	skillDir := filepath.Join(dir, name)
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "---\nname: " + name + "\ndescription: " + description + "\n---\n\nBody.\n"
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return skillDir
}

func exportTar(t *testing.T, skillDir string, id string) []byte {
	t.Helper()
	root := core.DiskRoot(filepath.Dir(skillDir))
	skillFS, normalize, err := core.ResolveSkillFS([]core.Root{root}, id)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := core.ExportSkill(skillFS, id, normalize, &buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// craftTar builds arbitrary (possibly malicious) tar streams for security
// tests.
type craftEntry struct {
	name     string
	typeflag byte
	linkname string
	content  string
}

func craftTar(t *testing.T, entries []craftEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	writer := tar.NewWriter(&buf)
	for _, entry := range entries {
		header := &tar.Header{
			Name:     entry.name,
			Typeflag: entry.typeflag,
			Linkname: entry.linkname,
			Mode:     0o644,
			Size:     int64(len(entry.content)),
		}
		if entry.typeflag == tar.TypeDir {
			header.Mode = 0o755
			header.Size = 0
		}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if entry.typeflag == tar.TypeReg && entry.content != "" {
			if _, err := io.WriteString(writer, entry.content); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestInstallFromDirectory(t *testing.T) {
	repo := initGitRepo(t)
	skillDir := writeSkill(t, t.TempDir(), "my-skill", "My skill")

	res := runCLITest([]string{skillDir, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	dest := filepath.Join(repo, ".codex", "skills", "my-skill")
	want := "Installed my-skill to " + dest + " (codex/repo)\n"
	if res.stderr.String() != want {
		t.Fatalf("stderr = %q, want %q", res.stderr.String(), want)
	}
	if res.stdout.Len() != 0 {
		t.Fatalf("stdout = %q", res.stdout.String())
	}
	if _, err := os.Stat(filepath.Join(dest, "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestInstallFromStdinTar(t *testing.T) {
	repo := initGitRepo(t)
	skillDir := writeSkill(t, t.TempDir(), "piped-skill", "Piped skill")
	data := exportTar(t, skillDir, "piped-skill")

	res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{
		Cwd:   repo,
		Stdin: bytes.NewReader(data),
	})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", "piped-skill", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestInstallDestinationExistsAndForce(t *testing.T) {
	repo := initGitRepo(t)
	skillDir := writeSkill(t, t.TempDir(), "dup-skill", "Dup skill")

	first := runCLITest([]string{skillDir, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if first.code != 0 {
		t.Fatalf("first install failed: %q", first.stderr.String())
	}

	dest := filepath.Join(repo, ".codex", "skills", "dup-skill")
	second := runCLITest([]string{skillDir, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if second.code != 1 {
		t.Fatalf("code = %d", second.code)
	}
	if second.stderr.String() != "Destination already exists: "+dest+"\n" {
		t.Fatalf("stderr = %q", second.stderr.String())
	}

	// Change the source, force-reinstall, and verify the content updated.
	if err := os.WriteFile(filepath.Join(skillDir, "extra.txt"), []byte("extra\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	forced := runCLITest([]string{skillDir, "--agent", "codex", "--scope", "repo", "--force"}, CLIOptions{Cwd: repo})
	if forced.code != 0 {
		t.Fatalf("forced install failed: %q", forced.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(dest, "extra.txt")); err != nil {
		t.Fatal(err)
	}
}

func TestInstallPreservesExecuteBits(t *testing.T) {
	repo := initGitRepo(t)
	skillDir := writeSkill(t, t.TempDir(), "exec-skill", "Exec skill")
	scriptPath := filepath.Join(skillDir, "run.sh")
	if err := os.WriteFile(scriptPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(scriptPath, 0o755); err != nil {
		t.Fatal(err)
	}

	res := runCLITest([]string{skillDir, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	info, err := os.Stat(filepath.Join(repo, ".codex", "skills", "exec-skill", "run.sh"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Fatalf("execute bits lost: %o", info.Mode().Perm())
	}
}

func TestInstallSkillIDComesFromFrontmatterName(t *testing.T) {
	repo := initGitRepo(t)
	dir := t.TempDir()
	skillDir := filepath.Join(dir, "some-directory")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	content := "---\nname: actual-name\ndescription: d\n---\n"
	if err := os.WriteFile(filepath.Join(skillDir, "SKILL.md"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	res := runCLITest([]string{skillDir, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", "actual-name", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func writeRawFile(t *testing.T, path string, content string) string {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestInstallValidationErrors(t *testing.T) {
	repo := initGitRepo(t)

	noName := t.TempDir()
	writeRawFile(t, filepath.Join(noName, "SKILL.md"), "---\ndescription: d\n---\n")
	noDescription := t.TempDir()
	writeRawFile(t, filepath.Join(noDescription, "SKILL.md"), "---\nname: n\n---\n")
	missing := filepath.Join(t.TempDir(), "nope")
	filePath := writeRawFile(t, filepath.Join(t.TempDir(), "file.txt"), "x")

	cases := []struct {
		name string
		path string
		want string
	}{
		{"missing SKILL.md", t.TempDir(), "SKILL.md not found in skill root."},
		{"missing name", noName, "SKILL.md metadata is missing name."},
		{"missing description", noDescription, "SKILL.md metadata is missing description."},
		{"missing path", missing, "PATH does not exist: " + missing},
		{"path is a file", filePath, "PATH must be a directory containing SKILL.md."},
	}
	for _, tc := range cases {
		res := runCLITest([]string{tc.path, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
		if res.code != 1 || res.stderr.String() != tc.want+"\n" {
			t.Errorf("%s: code=%d stderr=%q, want %q", tc.name, res.code, res.stderr.String(), tc.want+"\n")
		}
	}
}

func TestInstallFlagParsingErrors(t *testing.T) {
	cases := []struct {
		args []string
		want string
	}{
		{[]string{"--nope"}, "Unknown option: --nope"},
		{[]string{"--agent", "codex", "--agent", "claude"}, "Only one --agent flag is allowed."},
		{[]string{"--scope", "repo", "--scope", "user"}, "Only one --scope flag is allowed."},
		{[]string{"--agent", "codex,claude"}, "Only one value is allowed for --agent. Comma-separated values are not supported."},
		{[]string{"--scope", "repo,user"}, "Only one value is allowed for --scope. Comma-separated values are not supported."},
		{[]string{"--agent"}, "Missing value for --agent."},
		{[]string{"--scope"}, "Missing value for --scope."},
		{[]string{"--agent", "--scope"}, "Missing value for --agent."},
		{[]string{"--agent", "bogus", "--scope", "repo"}, "Unsupported agent: bogus"},
		{[]string{"--agent", "codex", "--scope", "bogus"}, "Unsupported scope: bogus"},
		{[]string{"--agent", "claude", "--scope", "cwd"}, "Unsupported agent/scope: claude cwd"},
	}
	for _, tc := range cases {
		res := runCLITest(tc.args, CLIOptions{Cwd: t.TempDir()})
		if res.code != 1 {
			t.Errorf("%v: code = %d", tc.args, res.code)
			continue
		}
		got := strings.TrimSuffix(res.stderr.String(), "\n")
		if got != tc.want {
			t.Errorf("%v: stderr = %q, want %q", tc.args, got, tc.want)
		}
	}
}

func TestInstallMissingRequiredFlagsNonTTY(t *testing.T) {
	res := runCLITest([]string{}, CLIOptions{Cwd: t.TempDir()})
	if res.code != 1 {
		t.Fatalf("code = %d", res.code)
	}
	if !strings.HasPrefix(res.stderr.String(), "Missing required flags.\nUsage:") {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
}

func TestInstallMissingInputNonTTYWithEmptyStdin(t *testing.T) {
	res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: t.TempDir()})
	if res.code != 1 || res.stderr.String() != "Tar stream was empty.\n" {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestInstallMissingInputTTY(t *testing.T) {
	tty := true
	res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{
		Cwd:        t.TempDir(),
		StdinIsTTY: &tty,
	})
	if res.code != 1 || !strings.HasPrefix(res.stderr.String(), "Missing PATH or tar stream on stdin.\nUsage:") {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestInstallHelp(t *testing.T) {
	res := runCLITest([]string{"--help"}, CLIOptions{})
	if res.code != 0 {
		t.Fatalf("code = %d", res.code)
	}
	if !strings.HasPrefix(res.stdout.String(), "Usage:\n  skill-install") {
		t.Fatalf("stdout = %q", res.stdout.String())
	}
	short := runCLITest([]string{"-h"}, CLIOptions{})
	if short.code != 0 || short.stdout.String() != res.stdout.String() {
		t.Fatalf("-h output differs")
	}
}

func TestInstallInteractivePromptNumbers(t *testing.T) {
	repo := initGitRepo(t)
	skillDir := writeSkill(t, t.TempDir(), "wizard-skill", "Wizard skill")
	tty := true

	// 1 = codex, then 1 = repo.
	res := runCLITest([]string{skillDir}, CLIOptions{
		Cwd:        repo,
		Stdin:      strings.NewReader("1\n1\n"),
		StdinIsTTY: &tty,
	})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", "wizard-skill", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.stderr.String(), "Select an agent:") ||
		!strings.Contains(res.stderr.String(), "Select a scope for codex:") {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
}

func TestInstallInteractivePromptNames(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	skillDir := writeSkill(t, t.TempDir(), "named-skill", "Named skill")
	tty := true

	res := runCLITest([]string{skillDir}, CLIOptions{
		Cwd:        t.TempDir(),
		Stdin:      strings.NewReader("claude\nuser\n"),
		StdinIsTTY: &tty,
	})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(home, ".claude", "skills", "named-skill", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestInstallInteractiveSingleScopeAutoSelected(t *testing.T) {
	repo := initGitRepo(t)
	skillDir := writeSkill(t, t.TempDir(), "cursor-skill", "Cursor skill")
	tty := true

	res := runCLITest([]string{skillDir}, CLIOptions{
		Cwd:        repo,
		Stdin:      strings.NewReader("cursor\n"),
		StdinIsTTY: &tty,
	})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(repo, ".cursor", "skills", "cursor-skill", "SKILL.md")); err != nil {
		t.Fatal(err)
	}
}

func TestInstallCollisionDetection(t *testing.T) {
	repo := initGitRepo(t)
	dirA := t.TempDir()
	dirB := t.TempDir()
	skillA := writeSkill(t, dirA, "same-name", "From A")
	skillB := writeSkill(t, dirB, "same-name", "From B")

	res := runCLITest([]string{skillA, skillB, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if res.code != 1 {
		t.Fatalf("code = %d", res.code)
	}
	stderr := res.stderr.String()
	if !strings.HasPrefix(stderr, "Install destination collisions detected:\n") {
		t.Fatalf("stderr = %q", stderr)
	}
	if !strings.Contains(stderr, "- "+filepath.Join(repo, ".codex", "skills", "same-name")+"\n") {
		t.Fatalf("stderr missing destination: %q", stderr)
	}
	if !strings.Contains(stderr, "  - same-name @ codex/repo (source: "+skillA+")") ||
		!strings.Contains(stderr, "  - same-name @ codex/repo (source: "+skillB+")") {
		t.Fatalf("stderr missing sources: %q", stderr)
	}
	if !strings.Contains(stderr, "Resolve collisions by changing skill IDs, sources, --agent, or --scope so each combination has a unique destination.") {
		t.Fatalf("stderr missing resolution hint: %q", stderr)
	}
	if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", "same-name")); !os.IsNotExist(err) {
		t.Fatal("nothing should have been installed")
	}
}

func TestInstallMultiplePaths(t *testing.T) {
	repo := initGitRepo(t)
	parent := t.TempDir()
	skillA := writeSkill(t, parent, "multi-a", "A")
	skillB := writeSkill(t, parent, "multi-b", "B")

	res := runCLITest([]string{skillA, skillB, "--agent", "codex", "--scope", "repo"}, CLIOptions{Cwd: repo})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	for _, id := range []string{"multi-a", "multi-b"} {
		if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", id, "SKILL.md")); err != nil {
			t.Fatalf("%s: %v", id, err)
		}
	}
}

func TestTarSecurityRejections(t *testing.T) {
	repo := initGitRepo(t)
	cases := []struct {
		name    string
		entries []craftEntry
		want    string
	}{
		{
			"dotdot traversal",
			[]craftEntry{{name: "../evil", typeflag: tar.TypeReg, content: "x"}},
			"Invalid path in tar: ../evil",
		},
		{
			"nested dotdot",
			[]craftEntry{{name: "a/../../evil", typeflag: tar.TypeReg, content: "x"}},
			"Invalid path in tar: a/../../evil",
		},
		{
			"absolute path",
			[]craftEntry{{name: "/abs/evil", typeflag: tar.TypeReg, content: "x"}},
			"Invalid path in tar: /abs/evil",
		},
		{
			"backslash",
			[]craftEntry{{name: `a\evil`, typeflag: tar.TypeReg, content: "x"}},
			`Invalid path in tar: a\evil`,
		},
		{
			"empty segment",
			[]craftEntry{{name: "a//evil", typeflag: tar.TypeReg, content: "x"}},
			"Invalid path in tar: a//evil",
		},
		{
			"two top-level directories",
			[]craftEntry{
				{name: "a/", typeflag: tar.TypeDir},
				{name: "b/", typeflag: tar.TypeDir},
			},
			"Tar must contain a single top-level directory.",
		},
		{
			"top-level file",
			[]craftEntry{{name: "loose-file", typeflag: tar.TypeReg, content: "x"}},
			"Tar must contain a single top-level directory.",
		},
		{
			"symlink entry",
			[]craftEntry{
				{name: "a/", typeflag: tar.TypeDir},
				{name: "a/link", typeflag: tar.TypeSymlink, linkname: "/etc/passwd"},
			},
			"Unsupported tar entry type: symlink",
		},
		{
			"hardlink entry",
			[]craftEntry{
				{name: "a/", typeflag: tar.TypeDir},
				{name: "a/link", typeflag: tar.TypeLink, linkname: "a/SKILL.md"},
			},
			"Unsupported tar entry type: link",
		},
		{
			"fifo entry",
			[]craftEntry{
				{name: "a/", typeflag: tar.TypeDir},
				{name: "a/pipe", typeflag: tar.TypeFifo},
			},
			"Unsupported tar entry type: fifo",
		},
	}
	for _, tc := range cases {
		data := craftTar(t, tc.entries)
		res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{
			Cwd:   repo,
			Stdin: bytes.NewReader(data),
		})
		if res.code != 1 {
			t.Errorf("%s: code = %d", tc.name, res.code)
			continue
		}
		if res.stderr.String() != tc.want+"\n" {
			t.Errorf("%s: stderr = %q, want %q", tc.name, res.stderr.String(), tc.want+"\n")
		}
	}
	if _, err := os.Stat(filepath.Join(repo, ".codex")); !os.IsNotExist(err) {
		t.Fatal("no destination should have been created")
	}
}

func TestTarStreamEmpty(t *testing.T) {
	var buf bytes.Buffer
	writer := tar.NewWriter(&buf)
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{
		Cwd:   t.TempDir(),
		Stdin: bytes.NewReader(buf.Bytes()),
	})
	if res.code != 1 || res.stderr.String() != "Tar stream was empty.\n" {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestTarWithoutSkillMd(t *testing.T) {
	data := craftTar(t, []craftEntry{
		{name: "bare/", typeflag: tar.TypeDir},
		{name: "bare/notes.txt", typeflag: tar.TypeReg, content: "hi"},
	})
	res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{
		Cwd:   t.TempDir(),
		Stdin: bytes.NewReader(data),
	})
	if res.code != 1 || res.stderr.String() != "SKILL.md not found in skill root.\n" {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestProvidedInputsRejectPathArgs(t *testing.T) {
	res := runCLITest([]string{"somewhere", "--agent", "codex", "--scope", "repo"}, CLIOptions{
		Cwd:            t.TempDir(),
		ProvidedInputs: []Input{{Tar: []byte{}}},
	})
	if res.code != 1 || res.stderr.String() != "PATH cannot be used when install input is preset.\n" {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestExtractedTreeMatchesSource(t *testing.T) {
	repo := initGitRepo(t)
	dir := t.TempDir()
	skillDir := writeSkill(t, dir, "tree-skill", "Tree skill")
	if err := os.MkdirAll(filepath.Join(skillDir, "templates"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skillDir, "templates", "hello.txt"), []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	data := exportTar(t, skillDir, "tree-skill")

	res := runCLITest([]string{"--agent", "codex", "--scope", "repo"}, CLIOptions{
		Cwd:   repo,
		Stdin: bytes.NewReader(data),
	})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}

	for _, rel := range []string{"SKILL.md", filepath.Join("templates", "hello.txt")} {
		want, err := os.ReadFile(filepath.Join(skillDir, rel))
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(filepath.Join(repo, ".codex", "skills", "tree-skill", rel))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Fatalf("%s differs after round-trip", rel)
		}
	}
}
