package skillflag

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func fixturesRoot(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("..", "..", "fixtures", "skills"))
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

type runResult struct {
	code   int
	stdout *bytes.Buffer
	stderr *bytes.Buffer
}

func runHandle(argv []string, opts Options) runResult {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	opts.Stdout = stdout
	opts.Stderr = stderr
	if opts.Stdin == nil {
		opts.Stdin = bytes.NewReader(nil)
	}
	code := Handle(argv, opts)
	return runResult{code: code, stdout: stdout, stderr: stderr}
}

func fixtureOpts(t *testing.T) Options {
	return Options{
		SkillsRoots:         []string{fixturesRoot(t)},
		IncludeBundledSkill: Bool(false),
	}
}

func initGitRepo(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	return dir
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestListTextOutputsSortedIDs(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "list"}, fixtureOpts(t))
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if res.stderr.Len() != 0 {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
	want := "alpha\tAlpha test skill\nbeta\tBeta test skill\n"
	if res.stdout.String() != want {
		t.Fatalf("stdout = %q, want %q", res.stdout.String(), want)
	}
}

func TestListIncludesBundledSkillByDefault(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "list"}, Options{SkillsRoots: []string{fixturesRoot(t)}})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	want := strings.Join([]string{
		"alpha\tAlpha test skill",
		"beta\tBeta test skill",
		"skillflag\tSkillflag producer/installer usage and install guidance (requires skill-install).",
		"",
	}, "\n")
	if res.stdout.String() != want {
		t.Fatalf("stdout = %q, want %q", res.stdout.String(), want)
	}
}

func TestListZeroSkillsPrintsNothing(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "list"}, Options{
		SkillsRoots:         []string{t.TempDir()},
		IncludeBundledSkill: Bool(false),
	})
	if res.code != 0 || res.stdout.Len() != 0 || res.stderr.Len() != 0 {
		t.Fatalf("code=%d stdout=%q stderr=%q", res.code, res.stdout.String(), res.stderr.String())
	}
}

func TestListStandaloneActionWithoutSkillFlag(t *testing.T) {
	res := runHandle([]string{"skillflag-go", "list"}, fixtureOpts(t))
	if res.code != 0 || !strings.HasPrefix(res.stdout.String(), "alpha\t") {
		t.Fatalf("code=%d stdout=%q", res.code, res.stdout.String())
	}
}

func TestListIgnoresUnrelatedArgs(t *testing.T) {
	res := runHandle(
		[]string{"cli", "--config", "foo", "--skill", "list", "--json", "--other", "bar"},
		fixtureOpts(t),
	)
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	var payload struct {
		Skills []struct {
			ID string `json:"id"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(res.stdout.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Skills) != 2 {
		t.Fatalf("skills = %v", payload.Skills)
	}
}

func TestListJSONFormatAndDigest(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "list", "--json"}, fixtureOpts(t))
	if res.code != 0 || res.stderr.Len() != 0 {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
	out := res.stdout.String()

	if strings.HasSuffix(out, "\n") {
		t.Fatal("JSON output must not end with a newline")
	}
	if !strings.HasPrefix(out, `{"skillflag_version":"0.1","skills":[{"id":"alpha","digest":"sha256:`) {
		t.Fatalf("unexpected key order/prefix: %q", out[:80])
	}
	if strings.Contains(out, ": ") || strings.Contains(out, ", ") {
		t.Fatalf("JSON must be compact: %q", out)
	}

	var payload struct {
		SkillflagVersion string `json:"skillflag_version"`
		Skills           []struct {
			ID      string `json:"id"`
			Digest  string `json:"digest"`
			Files   *int   `json:"files"`
			Summary string `json:"summary"`
		} `json:"skills"`
	}
	if err := json.Unmarshal([]byte(out), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.SkillflagVersion != "0.1" || len(payload.Skills) != 2 {
		t.Fatalf("payload = %+v", payload)
	}
	alpha := payload.Skills[0]
	if alpha.ID != "alpha" || alpha.Summary != "Alpha test skill" || alpha.Files == nil || *alpha.Files != 2 {
		t.Fatalf("alpha = %+v", alpha)
	}

	export := runHandle([]string{"cli", "--skill", "export", "alpha"}, fixtureOpts(t))
	if export.code != 0 {
		t.Fatalf("export failed: %q", export.stderr.String())
	}
	sum := sha256.Sum256(export.stdout.Bytes())
	if want := "sha256:" + hex.EncodeToString(sum[:]); alpha.Digest != want {
		t.Fatalf("digest = %s, want %s", alpha.Digest, want)
	}
}

func TestListJSONZeroSkills(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "list", "--json"}, Options{
		SkillsRoots:         []string{t.TempDir()},
		IncludeBundledSkill: Bool(false),
	})
	if res.code != 0 {
		t.Fatalf("code = %d", res.code)
	}
	if got, want := res.stdout.String(), `{"skillflag_version":"0.1","skills":[]}`; got != want {
		t.Fatalf("stdout = %q, want %q", got, want)
	}
}

func TestListMultipleRootsFirstWins(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	writeFile(t, filepath.Join(first, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha from first root\n---\n")
	writeFile(t, filepath.Join(second, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Alpha from second root\n---\n")
	writeFile(t, filepath.Join(second, "gamma", "SKILL.md"), "---\nname: gamma\ndescription: Gamma from second root\n---\n")

	res := runHandle([]string{"cli", "--skill", "list"}, Options{
		SkillsRoots:         []string{first, second},
		IncludeBundledSkill: Bool(false),
	})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	want := "alpha\tAlpha from first root\ngamma\tGamma from second root\n"
	if res.stdout.String() != want {
		t.Fatalf("stdout = %q, want %q", res.stdout.String(), want)
	}
}

func TestExportSingleTopLevelDirAndDeterminism(t *testing.T) {
	first := runHandle([]string{"cli", "--skill", "export", "alpha"}, fixtureOpts(t))
	second := runHandle([]string{"cli", "--skill", "export", "alpha"}, fixtureOpts(t))
	if first.code != 0 || second.code != 0 {
		t.Fatalf("codes = %d/%d", first.code, second.code)
	}
	if !bytes.Equal(first.stdout.Bytes(), second.stdout.Bytes()) {
		t.Fatal("exports are not byte-identical")
	}

	reader := tar.NewReader(bytes.NewReader(first.stdout.Bytes()))
	sawRoot, sawSkillMd := false, false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(header.Name, "alpha/") {
			t.Fatalf("entry %q escapes alpha/", header.Name)
		}
		if header.Name == "alpha/" {
			sawRoot = true
		}
		if header.Name == "alpha/SKILL.md" {
			sawSkillMd = true
		}
	}
	if !sawRoot || !sawSkillMd {
		t.Fatal("missing alpha/ or alpha/SKILL.md entries")
	}
}

func TestBundledSkillExportUsesNormalizedModes(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "export", "skillflag"}, Options{})
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	reader := tar.NewReader(bytes.NewReader(res.stdout.Bytes()))
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Typeflag == tar.TypeDir && header.Mode != 0o755 {
			t.Errorf("%s: dir mode %o, want 755", header.Name, header.Mode)
		}
		if header.Typeflag == tar.TypeReg && header.Mode != 0o644 {
			t.Errorf("%s: file mode %o, want 644", header.Name, header.Mode)
		}
	}
}

func TestExportUnknownID(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "export", "missing"}, fixtureOpts(t))
	if res.code != 1 {
		t.Fatalf("code = %d", res.code)
	}
	if res.stdout.Len() != 0 {
		t.Fatalf("stdout = %q", res.stdout.String())
	}
	if res.stderr.String() != "Skill not found: missing\n" {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
}

func TestInvalidSkillIDs(t *testing.T) {
	cases := map[string]string{
		".":   "Skill id is required.\n",
		"..":  "Skill id is required.\n",
		"a/b": "Invalid skill id: a/b\n",
		`a\b`: `Invalid skill id: a\b` + "\n",
	}
	for id, wantErr := range cases {
		res := runHandle([]string{"cli", "--skill", "export", id}, fixtureOpts(t))
		if res.code != 1 || res.stderr.String() != wantErr {
			t.Fatalf("id %q: code=%d stderr=%q, want %q", id, res.code, res.stderr.String(), wantErr)
		}
	}
}

func TestMissingSkillID(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "export"}, fixtureOpts(t))
	if res.code != 1 || !strings.HasPrefix(res.stderr.String(), "Missing skill id.\nUsage:") {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestMissingAndUnknownAction(t *testing.T) {
	res := runHandle([]string{"cli", "--skill"}, fixtureOpts(t))
	if res.code != 1 || !strings.HasPrefix(res.stderr.String(), "Missing --skill action.\nUsage:") {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
	res = runHandle([]string{"cli", "--skill", "bogus"}, fixtureOpts(t))
	if res.code != 1 || !strings.HasPrefix(res.stderr.String(), "Unknown --skill action: bogus.\nUsage:") {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestShowPrintsRawSkillMd(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "show", "alpha"}, fixtureOpts(t))
	if res.code != 0 || res.stderr.Len() != 0 {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
	disk, err := os.ReadFile(filepath.Join(fixturesRoot(t), "alpha", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(res.stdout.Bytes(), disk) {
		t.Fatalf("stdout = %q, want raw SKILL.md bytes", res.stdout.String())
	}
}

func TestHelpOutput(t *testing.T) {
	res := runHandle([]string{"cli", "--skill", "help"}, fixtureOpts(t))
	if res.code != 0 || res.stderr.Len() != 0 {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
	if res.stdout.String() != HelpText+"\n" {
		t.Fatalf("stdout = %q", res.stdout.String())
	}
}

func TestMaybeHandle(t *testing.T) {
	handled, code := MaybeHandle([]string{"cli", "serve", "--port", "8080"}, fixtureOpts(t))
	if handled || code != 0 {
		t.Fatalf("handled=%v code=%d", handled, code)
	}

	stdout := &bytes.Buffer{}
	opts := fixtureOpts(t)
	opts.Stdout = stdout
	opts.Stderr = &bytes.Buffer{}
	handled, code = MaybeHandle([]string{"cli", "--skill", "list"}, opts)
	if !handled || code != 0 || !strings.Contains(stdout.String(), "alpha") {
		t.Fatalf("handled=%v code=%d stdout=%q", handled, code, stdout.String())
	}
}

func TestFindSkillsRoots(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, "skills", "tool-skill", "SKILL.md"), "---\nname: tool-skill\ndescription: d\n---\n")
	writeFile(t, filepath.Join(repo, ".agents", "skills", "portable-skill", "SKILL.md"), "---\nname: portable-skill\ndescription: d\n---\n")
	writeFile(t, filepath.Join(repo, "dist", "cli"), "")

	roots, err := FindSkillsRoots(filepath.Join(repo, "dist", "cli"))
	if err != nil {
		t.Fatal(err)
	}
	want := []string{filepath.Join(repo, "skills"), filepath.Join(repo, ".agents", "skills")}
	if len(roots) != 2 || roots[0] != want[0] || roots[1] != want[1] {
		t.Fatalf("roots = %v, want %v", roots, want)
	}

	root, err := FindSkillsRoot(filepath.Join(repo, "dist", "cli"))
	if err != nil {
		t.Fatal(err)
	}
	if root != want[0] {
		t.Fatalf("root = %q, want %q", root, want[0])
	}
}

func TestFindSkillsRootPortableOnly(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, filepath.Join(repo, ".agents", "skills", "p", "SKILL.md"), "---\nname: p\ndescription: d\n---\n")
	writeFile(t, filepath.Join(repo, "dist", "cli"), "")

	root, err := FindSkillsRoot(filepath.Join(repo, "dist", "cli"))
	if err != nil {
		t.Fatal(err)
	}
	if root != filepath.Join(repo, ".agents", "skills") {
		t.Fatalf("root = %q", root)
	}
}

func TestFindSkillsRootNotFound(t *testing.T) {
	_, err := FindSkillsRoot(filepath.Join(t.TempDir(), "nothing", "here"))
	if err == nil || err.Error() != "Could not find a skills/ or .agents/skills/ directory. Pass skillsRoot explicitly." {
		t.Fatalf("err = %v", err)
	}
}

func TestInstallDelegatesToInstaller(t *testing.T) {
	repo := initGitRepo(t)
	opts := fixtureOpts(t)
	opts.Cwd = repo
	res := runHandle(
		[]string{"cli", "--skill", "install", "alpha", "--agent", "codex", "--scope", "repo"},
		opts,
	)
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if !strings.Contains(res.stderr.String(), "Installed alpha to") {
		t.Fatalf("stderr = %q", res.stderr.String())
	}

	installed, err := os.ReadFile(filepath.Join(repo, ".codex", "skills", "alpha", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	disk, err := os.ReadFile(filepath.Join(fixturesRoot(t), "alpha", "SKILL.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(installed, disk) {
		t.Fatal("installed SKILL.md differs from fixture")
	}
	nested, err := os.ReadFile(filepath.Join(repo, ".codex", "skills", "alpha", "templates", "hello.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(nested) != "hello alpha\n" {
		t.Fatalf("nested file = %q", nested)
	}
}

func TestInstallCommaSeparatedIDs(t *testing.T) {
	repo := initGitRepo(t)
	opts := fixtureOpts(t)
	opts.Cwd = repo
	res := runHandle(
		[]string{"cli", "--skill", "install", "alpha,beta", "--agent", "codex", "--scope", "repo"},
		opts,
	)
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	for _, id := range []string{"alpha", "beta"} {
		if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", id, "SKILL.md")); err != nil {
			t.Fatalf("%s not installed: %v", id, err)
		}
	}
}

func TestInstallNoIDsSingleSkillAutoSelected(t *testing.T) {
	repo := initGitRepo(t)
	skillsRoot := t.TempDir()
	writeFile(t, filepath.Join(skillsRoot, "only-skill", "SKILL.md"), "---\nname: only-skill\ndescription: Only skill\n---\n")

	res := runHandle(
		[]string{"cli", "--skill", "install", "--agent", "codex", "--scope", "repo"},
		Options{
			SkillsRoots:         []string{skillsRoot},
			IncludeBundledSkill: Bool(false),
			Cwd:                 repo,
		},
	)
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	if !strings.Contains(res.stderr.String(), "Installed only-skill to") {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
}

func TestInstallNoIDsMultipleNonTTY(t *testing.T) {
	res := runHandle(
		[]string{"cli", "--skill", "install", "--agent", "codex", "--scope", "repo"},
		fixtureOpts(t),
	)
	if res.code != 1 {
		t.Fatalf("code = %d", res.code)
	}
	want := "Multiple skills are available; pass one or more ids with --skill install <id> [...].\n"
	if res.stderr.String() != want {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
}

func TestInstallNoIDsZeroSkills(t *testing.T) {
	res := runHandle(
		[]string{"cli", "--skill", "install", "--agent", "codex", "--scope", "repo"},
		Options{SkillsRoots: []string{t.TempDir()}, IncludeBundledSkill: Bool(false)},
	)
	if res.code != 1 || res.stderr.String() != "No skills are available to install.\n" {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}

func TestInstallNoIDsMultipleTTYPrompt(t *testing.T) {
	repo := initGitRepo(t)
	opts := fixtureOpts(t)
	opts.Cwd = repo
	opts.Stdin = strings.NewReader("1,beta\n")
	opts.StdinIsTTY = Bool(true)

	res := runHandle(
		[]string{"cli", "--skill", "install", "--agent", "codex", "--scope", "repo"},
		opts,
	)
	if res.code != 0 {
		t.Fatalf("code = %d, stderr = %q", res.code, res.stderr.String())
	}
	for _, id := range []string{"alpha", "beta"} {
		if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", id, "SKILL.md")); err != nil {
			t.Fatalf("%s not installed: %v", id, err)
		}
	}
	if !strings.Contains(res.stderr.String(), "Select skills to install:") {
		t.Fatalf("stderr = %q", res.stderr.String())
	}
}

func TestInstallRejectsRepeatedFlags(t *testing.T) {
	repo := initGitRepo(t)
	opts := fixtureOpts(t)
	opts.Cwd = repo
	res := runHandle(
		[]string{"cli", "--skill", "install", "alpha", "--agent", "codex", "--scope", "repo", "--scope", "user"},
		opts,
	)
	if res.code != 1 || !strings.HasPrefix(res.stderr.String(), "Only one --scope flag is allowed.") {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
	if _, err := os.Stat(filepath.Join(repo, ".codex", "skills", "alpha")); !os.IsNotExist(err) {
		t.Fatal("nothing should have been installed")
	}

	res = runHandle(
		[]string{"cli", "--skill", "install", "alpha", "--agent", "codex", "--agent", "claude", "--scope", "repo"},
		opts,
	)
	if res.code != 1 || !strings.HasPrefix(res.stderr.String(), "Only one --agent flag is allowed.") {
		t.Fatalf("code=%d stderr=%q", res.code, res.stderr.String())
	}
}
