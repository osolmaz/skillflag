package main

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func fixturesRoot(t *testing.T) string {
	t.Helper()
	abs, err := filepath.Abs(filepath.Join("..", "..", "..", "fixtures", "skills"))
	if err != nil {
		t.Fatal(err)
	}
	return abs
}

func runMain(t *testing.T, argv []string, skillsRootEnv string, stdin string) (int, string, string) {
	t.Helper()
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	code := run(argv, skillsRootEnv, strings.NewReader(stdin), stdout, stderr)
	return code, stdout.String(), stderr.String()
}

func TestDefaultRootIsBundledSkillOnly(t *testing.T) {
	code, stdout, stderr := runMain(t, []string{"skillflag-go", "--skill", "list"}, "", "")
	if code != 0 || stderr != "" {
		t.Fatalf("code=%d stderr=%q", code, stderr)
	}
	want := "skillflag\tSkillflag producer/installer usage and install guidance (requires skill-install).\n"
	if stdout != want {
		t.Fatalf("stdout = %q, want %q", stdout, want)
	}
}

func TestSkillsRootEnvReplacesBundledSkill(t *testing.T) {
	t.Setenv("SKILLFLAG_SKILLS_ROOT", fixturesRoot(t))

	code, stdout, stderr := runMain(
		t, []string{"skillflag-go", "--skill", "list"}, fixturesRoot(t), "")
	if code != 0 || stderr != "" {
		t.Fatalf("code=%d stderr=%q", code, stderr)
	}
	want := "alpha\tAlpha test skill\nbeta\tBeta test skill\n"
	if stdout != want {
		t.Fatalf("stdout = %q, want %q", stdout, want)
	}
	if strings.Contains(stdout, "skillflag\t") {
		t.Fatal("bundled skill must be excluded when SKILLFLAG_SKILLS_ROOT is set")
	}
}

func TestSkillsRootEnvSupportsPathList(t *testing.T) {
	second := t.TempDir()
	writeSkillDir(t, second, "zeta", "Zeta skill")
	env := fixturesRoot(t) + string(filepath.ListSeparator) + second

	code, stdout, stderr := runMain(t, []string{"skillflag-go", "list"}, env, "")
	if code != 0 || stderr != "" {
		t.Fatalf("code=%d stderr=%q", code, stderr)
	}
	want := "alpha\tAlpha test skill\nbeta\tBeta test skill\nzeta\tZeta skill\n"
	if stdout != want {
		t.Fatalf("stdout = %q, want %q", stdout, want)
	}
}

func TestInstallRoutesToInstallerCLI(t *testing.T) {
	code, stdout, stderr := runMain(t, []string{"skillflag-go", "install", "--help"}, "", "")
	if code != 0 || stderr != "" {
		t.Fatalf("code=%d stderr=%q", code, stderr)
	}
	if !strings.HasPrefix(stdout, "Usage:\n  skill-install") {
		t.Fatalf("stdout = %q", stdout)
	}
}

func TestInstallRoutesPathInstall(t *testing.T) {
	repo, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = repo
	if out, gitErr := cmd.CombinedOutput(); gitErr != nil {
		t.Fatalf("git init: %v: %s", gitErr, out)
	}
	skillDir := writeSkillDir(t, t.TempDir(), "bin-path-skill", "Binary install path test")

	chdir(t, repo)
	code, _, stderr := runMain(
		t, []string{"skillflag-go", "install", skillDir, "--agent", "codex", "--scope", "repo"}, "", "")
	if code != 0 {
		t.Fatalf("code=%d stderr=%q", code, stderr)
	}
	if !strings.Contains(stderr, "Installed bin-path-skill to") {
		t.Fatalf("stderr = %q", stderr)
	}
	if !fileExists(filepath.Join(repo, ".codex", "skills", "bin-path-skill", "SKILL.md")) {
		t.Fatal("skill not installed")
	}
}
