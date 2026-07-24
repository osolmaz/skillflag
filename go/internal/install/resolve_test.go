package install

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func initGitRepo(t *testing.T) string {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(context.Background(), "git", "init", "-q")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	return dir
}

func TestResolveSkillsRootTable(t *testing.T) {
	home := t.TempDir()
	xdg := filepath.Join(home, "xdg")
	codexHome := filepath.Join(home, "codex-home")
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", xdg)
	t.Setenv("CODEX_HOME", codexHome)

	repo := initGitRepo(t)
	nonRepo := t.TempDir()

	cases := []struct {
		agent string
		scope string
		cwd   string
		want  string
	}{
		{"codex", "repo", repo, filepath.Join(repo, ".codex/skills")},
		{"codex", "cwd", nonRepo, filepath.Join(nonRepo, ".codex/skills")},
		{"codex", "user", repo, filepath.Join(codexHome, "skills")},
		{"claude", "repo", repo, filepath.Join(repo, ".claude/skills")},
		{"claude", "user", repo, filepath.Join(home, ".claude/skills")},
		{"portable", "repo", repo, filepath.Join(repo, ".agents/skills")},
		{"portable", "user", repo, filepath.Join(xdg, "agents/skills")},
		{"vscode", "repo", repo, filepath.Join(repo, ".github/skills")},
		{"copilot", "repo", repo, filepath.Join(repo, ".github/skills")},
		{"amp", "repo", repo, filepath.Join(repo, ".agents/skills")},
		{"amp", "user", repo, filepath.Join(xdg, "agents/skills")},
		{"goose", "repo", repo, filepath.Join(repo, ".agents/skills")},
		{"goose", "user", repo, filepath.Join(xdg, "agents/skills")},
		{"opencode", "repo", repo, filepath.Join(repo, ".opencode/skill")},
		{"opencode", "user", repo, filepath.Join(xdg, "opencode/skill")},
		{"factory", "repo", repo, filepath.Join(repo, ".factory/skills")},
		{"factory", "user", repo, filepath.Join(home, ".factory/skills")},
		{"cursor", "repo", repo, filepath.Join(repo, ".cursor/skills")},
	}
	for _, tc := range cases {
		got, err := ResolveSkillsRoot(tc.agent, tc.scope, tc.cwd)
		if err != nil {
			t.Errorf("%s/%s: %v", tc.agent, tc.scope, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%s/%s = %q, want %q", tc.agent, tc.scope, got, tc.want)
		}
	}
}

func TestResolveSkillsRootDefaults(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	// Register cleanup via t.Setenv, then unset to exercise the fallbacks.
	t.Setenv("CODEX_HOME", "x")
	t.Setenv("XDG_CONFIG_HOME", "x")
	_ = os.Unsetenv("CODEX_HOME")
	_ = os.Unsetenv("XDG_CONFIG_HOME")

	got, err := ResolveSkillsRoot("codex", "user", home)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, ".codex", "skills"); got != want {
		t.Fatalf("codex/user = %q, want %q", got, want)
	}

	got, err = ResolveSkillsRoot("portable", "user", home)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, ".config", "agents", "skills"); got != want {
		t.Fatalf("portable/user = %q, want %q", got, want)
	}
}

func TestRepoRootFallsBackToCwd(t *testing.T) {
	nonRepo, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	got, resolveErr := ResolveSkillsRoot("claude", "repo", nonRepo)
	if resolveErr != nil {
		t.Fatal(resolveErr)
	}
	if got != filepath.Join(nonRepo, ".claude/skills") {
		t.Fatalf("got %q", got)
	}
}

func TestUnsupportedCombos(t *testing.T) {
	cases := []struct {
		agent string
		scope string
		want  string
	}{
		{"claude", "cwd", "Unsupported agent/scope: claude cwd"},
		{"vscode", "user", "Unsupported agent/scope: vscode user"},
		{"cursor", "user", "Unsupported agent/scope: cursor user"},
		{"portable", "cwd", "Unsupported agent/scope: portable cwd"},
	}
	for _, tc := range cases {
		if _, err := ResolveSkillsRoot(tc.agent, tc.scope, t.TempDir()); err == nil || err.Error() != tc.want {
			t.Errorf("%s/%s err = %v, want %q", tc.agent, tc.scope, err, tc.want)
		}
		if err := AssertSupportedAgentScopes([]string{tc.agent}, []string{tc.scope}); err == nil || err.Error() != tc.want {
			t.Errorf("assert %s/%s err = %v, want %q", tc.agent, tc.scope, err, tc.want)
		}
	}
}

func TestAssertAgentAndScope(t *testing.T) {
	if _, err := AssertAgent("bogus"); err == nil || err.Error() != "Unsupported agent: bogus" {
		t.Fatalf("err = %v", err)
	}
	if _, err := AssertScope("bogus"); err == nil || err.Error() != "Unsupported scope: bogus" {
		t.Fatalf("err = %v", err)
	}
	if agent, err := AssertAgent("codex"); err != nil || agent != "codex" {
		t.Fatalf("agent=%q err=%v", agent, err)
	}
	if scope, err := AssertScope("repo"); err != nil || scope != "repo" {
		t.Fatalf("scope=%q err=%v", scope, err)
	}
}

func TestSupportedScopesForAgent(t *testing.T) {
	if got := SupportedScopesForAgent("codex"); !reflect.DeepEqual(got, []string{"repo", "cwd", "user"}) {
		t.Fatalf("codex scopes = %v", got)
	}
	if got := SupportedScopesForAgent("cursor"); !reflect.DeepEqual(got, []string{"repo"}) {
		t.Fatalf("cursor scopes = %v", got)
	}
}
