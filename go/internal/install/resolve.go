package install

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Agents lists the supported agent targets, in wizard/listing order.
var Agents = []string{
	"codex",
	"claude",
	"portable",
	"vscode",
	"copilot",
	"amp",
	"goose",
	"opencode",
	"factory",
	"cursor",
}

// Scopes lists the supported scopes.
var Scopes = []string{"repo", "user", "cwd"}

// ResolveRepoRoot returns `git rev-parse --show-toplevel` run in cwd, falling
// back to cwd itself outside a git worktree.
func ResolveRepoRoot(cwd string) string {
	cmd := exec.Command("git", "rev-parse", "--show-toplevel")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err == nil {
		if root := strings.TrimSpace(string(out)); root != "" {
			return root
		}
	}
	return cwd
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return home
}

func configRoot() string {
	if value, ok := os.LookupEnv("XDG_CONFIG_HOME"); ok {
		return value
	}
	return filepath.Join(homeDir(), ".config")
}

type scopeResolver struct {
	scope   string
	resolve func(cwd string) string
}

// agentScopeResolvers preserves the per-agent scope declaration order of the
// reference implementation (relevant for interactive listings).
var agentScopeResolvers = map[string][]scopeResolver{
	"codex": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".codex/skills") }},
		{"cwd", func(cwd string) string { return filepath.Join(cwd, ".codex/skills") }},
		{"user", func(string) string {
			root, ok := os.LookupEnv("CODEX_HOME")
			if !ok {
				root = filepath.Join(homeDir(), ".codex")
			}
			return filepath.Join(root, "skills")
		}},
	},
	"claude": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".claude/skills") }},
		{"user", func(string) string { return filepath.Join(homeDir(), ".claude/skills") }},
	},
	"portable": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".agents/skills") }},
		{"user", func(string) string { return filepath.Join(configRoot(), "agents/skills") }},
	},
	"vscode": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".github/skills") }},
	},
	"copilot": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".github/skills") }},
	},
	"amp": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".agents/skills") }},
		{"user", func(string) string { return filepath.Join(configRoot(), "agents/skills") }},
	},
	"goose": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".agents/skills") }},
		{"user", func(string) string { return filepath.Join(configRoot(), "agents/skills") }},
	},
	"opencode": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".opencode/skill") }},
		{"user", func(string) string { return filepath.Join(configRoot(), "opencode/skill") }},
	},
	"factory": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".factory/skills") }},
		{"user", func(string) string { return filepath.Join(homeDir(), ".factory/skills") }},
	},
	"cursor": {
		{"repo", func(cwd string) string { return filepath.Join(ResolveRepoRoot(cwd), ".cursor/skills") }},
	},
}

// AssertAgent validates an agent name.
func AssertAgent(value string) (string, error) {
	for _, agent := range Agents {
		if agent == value {
			return value, nil
		}
	}
	return "", fmt.Errorf("Unsupported agent: %s", value)
}

// AssertScope validates a scope name.
func AssertScope(value string) (string, error) {
	for _, scope := range Scopes {
		if scope == value {
			return value, nil
		}
	}
	return "", fmt.Errorf("Unsupported scope: %s", value)
}

// SupportedScopesForAgent returns the scopes an agent supports, in
// declaration order.
func SupportedScopesForAgent(agent string) []string {
	resolvers := agentScopeResolvers[agent]
	scopes := make([]string, 0, len(resolvers))
	for _, r := range resolvers {
		scopes = append(scopes, r.scope)
	}
	return scopes
}

// AssertSupportedAgentScopes rejects any agent/scope pair without a resolver.
func AssertSupportedAgentScopes(agents []string, scopes []string) error {
	for _, agent := range agents {
		supported := SupportedScopesForAgent(agent)
		for _, scope := range scopes {
			found := false
			for _, s := range supported {
				if s == scope {
					found = true
					break
				}
			}
			if !found {
				return fmt.Errorf("Unsupported agent/scope: %s %s", agent, scope)
			}
		}
	}
	return nil
}

// ResolveSkillsRoot maps an agent/scope pair to its skills root directory.
func ResolveSkillsRoot(agent string, scope string, cwd string) (string, error) {
	for _, r := range agentScopeResolvers[agent] {
		if r.scope == scope {
			return r.resolve(cwd), nil
		}
	}
	return "", fmt.Errorf("Unsupported agent/scope: %s %s", agent, scope)
}
