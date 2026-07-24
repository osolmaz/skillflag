package install

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// CLIOptions injects streams and preset inputs into RunCLI.
type CLIOptions struct {
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
	Cwd    string
	// ProvidedInputs preset the install sources (used by the producer's
	// `--skill install` convenience); PATH arguments are then rejected.
	ProvidedInputs []Input
	// ProvidedSkillIDs pair with ProvidedInputs as destination hints.
	ProvidedSkillIDs []string
	// StdinIsTTY overrides TTY detection (for tests).
	StdinIsTTY *bool
}

type parsedArgs struct {
	inputPaths []string
	agent      string
	scope      string
	force      bool
	help       bool
}

type preparedSource struct {
	source string
	hint   string
	input  Input
}

type planItem struct {
	source      preparedSource
	agent       string
	scope       string
	destination string
}

var usageText = strings.Join([]string{
	"Usage:",
	"  skill-install [PATH ...] [--agent <agent>] [--scope <scope>] [--force]",
	"",
	"Input:",
	"  PATH ...            Skill directory path(s) containing SKILL.md.",
	"  stdin tar stream    If PATH is omitted, reads a tar bundle from stdin.",
	"",
	"Options:",
	"  --agent <value>     Target agent (single value).",
	"                      Supported agents: " + strings.Join(Agents, ", "),
	"  --scope <value>     Target scope (single value).",
	"                      Supported scopes: " + strings.Join(Scopes, ", "),
	"  --force             Overwrite destination if it already exists.",
	"  -h, --help          Show this help.",
	"",
	"Behavior:",
	"  If --agent or --scope is missing and an interactive TTY is available,",
	"  the installer launches a wizard to collect missing values.",
	"  CLI flags accept only one --agent and one --scope.",
	"  Use the wizard to select multiple agents/scopes.",
}, "\n")

func parseAgentValue(value string, ok bool) (string, error) {
	if !ok || value == "" || strings.HasPrefix(value, "-") {
		return "", errors.New("Missing value for --agent.")
	}
	agent := strings.TrimSpace(value)
	if agent == "" {
		return "", errors.New("Missing value for --agent.")
	}
	if strings.Contains(agent, ",") {
		return "", errors.New("Only one value is allowed for --agent. Comma-separated values are not supported.")
	}
	return agent, nil
}

func parseScopeValue(value string, ok bool) (string, error) {
	if !ok || value == "" || strings.HasPrefix(value, "-") {
		return "", errors.New("Missing value for --scope.")
	}
	scope := strings.TrimSpace(value)
	if scope == "" {
		return "", errors.New("Missing value for --scope.")
	}
	if strings.Contains(scope, ",") {
		return "", errors.New("Only one value is allowed for --scope. Comma-separated values are not supported.")
	}
	return scope, nil
}

func parseArgs(args []string) (parsedArgs, error) {
	var parsed parsedArgs
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--agent":
			if parsed.agent != "" {
				return parsedArgs{}, errors.New("Only one --agent flag is allowed.")
			}
			next, ok := "", false
			if i+1 < len(args) {
				next, ok = args[i+1], true
			}
			agent, err := parseAgentValue(next, ok)
			if err != nil {
				return parsedArgs{}, err
			}
			parsed.agent = agent
			i++
		case arg == "--scope":
			if parsed.scope != "" {
				return parsedArgs{}, errors.New("Only one --scope flag is allowed.")
			}
			next, ok := "", false
			if i+1 < len(args) {
				next, ok = args[i+1], true
			}
			scope, err := parseScopeValue(next, ok)
			if err != nil {
				return parsedArgs{}, err
			}
			parsed.scope = scope
			i++
		case arg == "--force":
			parsed.force = true
		case arg == "--help" || arg == "-h":
			parsed.help = true
		case strings.HasPrefix(arg, "-"):
			return parsedArgs{}, fmt.Errorf("Unknown option: %s", arg)
		default:
			parsed.inputPaths = append(parsed.inputPaths, arg)
		}
	}
	return parsed, nil
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

func drainStdin(stdin io.Reader) {
	// Drain remaining piped stdin bytes so upstream writers do not hit
	// EPIPE when we exit early. Errors are ignored deliberately.
	_, _ = io.Copy(io.Discard, stdin)
}

func prepareDirSource(inputPath string, cwd string) (preparedSource, error) {
	sourceDir := absAgainst(inputPath, cwd)
	info, err := os.Stat(sourceDir)
	if err != nil {
		return preparedSource{}, fmt.Errorf("PATH does not exist: %s", sourceDir)
	}
	if !info.IsDir() {
		return preparedSource{}, errors.New("PATH must be a directory containing SKILL.md.")
	}
	if err := AssertSkillDir(sourceDir); err != nil {
		return preparedSource{}, err
	}
	meta, err := ReadSkillMetadata(sourceDir)
	if err != nil {
		return preparedSource{}, err
	}
	return preparedSource{
		source: sourceDir,
		hint:   meta.Name,
		input:  Input{Dir: sourceDir},
	}, nil
}

func resolveInstallSources(
	inputPaths []string,
	stdin io.Reader,
	tty bool,
	provided []Input,
	providedIDs []string,
	cwd string,
) ([]preparedSource, error) {
	if len(inputPaths) > 0 && len(provided) > 0 {
		return nil, errors.New("PATH cannot be used when install input is preset.")
	}

	if len(inputPaths) > 0 {
		sources := make([]preparedSource, 0, len(inputPaths))
		for _, inputPath := range inputPaths {
			source, err := prepareDirSource(inputPath, cwd)
			if err != nil {
				return nil, err
			}
			sources = append(sources, source)
		}
		return sources, nil
	}

	if len(provided) > 0 {
		sources := make([]preparedSource, 0, len(provided))
		for i, input := range provided {
			if input.Dir != "" {
				source, err := prepareDirSource(input.Dir, cwd)
				if err != nil {
					return nil, err
				}
				sources = append(sources, source)
				continue
			}
			hint := "<from skill bundle>"
			if i < len(providedIDs) && providedIDs[i] != "" {
				hint = providedIDs[i]
			}
			sources = append(sources, preparedSource{source: "tar stream", hint: hint, input: input})
		}
		return sources, nil
	}

	if !tty {
		data, err := io.ReadAll(stdin)
		if err != nil {
			return nil, err
		}
		return []preparedSource{{
			source: "tar stream",
			hint:   "<from skill bundle>",
			input:  Input{Tar: data},
		}}, nil
	}

	return nil, fmt.Errorf("Missing PATH or tar stream on stdin.\n%s", usageText)
}

func buildInstallPlan(sources []preparedSource, agent string, scope string, cwd string) ([]planItem, error) {
	plan := make([]planItem, 0, len(sources))
	for _, source := range sources {
		skillsRoot, err := ResolveSkillsRoot(agent, scope, cwd)
		if err != nil {
			return nil, err
		}
		plan = append(plan, planItem{
			source:      source,
			agent:       agent,
			scope:       scope,
			destination: filepath.Join(skillsRoot, source.hint),
		})
	}
	return plan, nil
}

func assertNoInstallCollisions(plan []planItem) error {
	byDestination := map[string][]planItem{}
	for _, item := range plan {
		byDestination[item.destination] = append(byDestination[item.destination], item)
	}

	var destinations []string
	for destination, items := range byDestination {
		if len(items) > 1 {
			destinations = append(destinations, destination)
		}
	}
	if len(destinations) == 0 {
		return nil
	}
	sort.Strings(destinations)

	lines := []string{"Install destination collisions detected:"}
	for _, destination := range destinations {
		lines = append(lines, fmt.Sprintf("- %s", destination))
		for _, item := range byDestination[destination] {
			lines = append(lines, fmt.Sprintf(
				"  - %s @ %s/%s (source: %s)",
				item.source.hint, item.agent, item.scope, item.source.source,
			))
		}
	}
	lines = append(lines,
		"Resolve collisions by changing skill IDs, sources, --agent, or --scope so each combination has a unique destination.",
	)
	return errors.New(strings.Join(lines, "\n"))
}

func readPromptLine(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil && line == "" {
		return "", errors.New("Install cancelled.")
	}
	return strings.TrimSpace(line), nil
}

func promptAgent(reader *bufio.Reader, stderr io.Writer) (string, error) {
	fmt.Fprintln(stderr, "Select an agent:")
	for i, agent := range Agents {
		fmt.Fprintf(stderr, "  %d. %s\n", i+1, agent)
	}
	fmt.Fprint(stderr, "Agent (number or name): ")
	selection, err := readPromptLine(reader)
	if err != nil {
		return "", err
	}
	if selection == "" {
		return "", errors.New("Install cancelled.")
	}
	if n, convErr := strconv.Atoi(selection); convErr == nil {
		if n < 1 || n > len(Agents) {
			return "", fmt.Errorf("Invalid selection: %s", selection)
		}
		return Agents[n-1], nil
	}
	return AssertAgent(selection)
}

func promptScope(reader *bufio.Reader, stderr io.Writer, agent string) (string, error) {
	scopes := SupportedScopesForAgent(agent)
	if len(scopes) == 1 {
		return scopes[0], nil
	}
	fmt.Fprintf(stderr, "Select a scope for %s:\n", agent)
	for i, scope := range scopes {
		fmt.Fprintf(stderr, "  %d. %s\n", i+1, scope)
	}
	fmt.Fprint(stderr, "Scope (number or name): ")
	selection, err := readPromptLine(reader)
	if err != nil {
		return "", err
	}
	if selection == "" {
		return "", errors.New("Install cancelled.")
	}
	if n, convErr := strconv.Atoi(selection); convErr == nil {
		if n < 1 || n > len(scopes) {
			return "", fmt.Errorf("Invalid selection: %s", selection)
		}
		return scopes[n-1], nil
	}
	return AssertScope(selection)
}

// RunCLI runs the skill-install command line. args are the arguments after
// the program name. It returns the process exit code; errors are written to
// stderr.
func RunCLI(args []string, opts CLIOptions) int {
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
	cwd := opts.Cwd
	if cwd == "" {
		if wd, err := os.Getwd(); err == nil {
			cwd = wd
		}
	}
	tty := stdinIsTTY(stdin, opts.StdinIsTTY)

	code, err := runCLI(args, stdin, stdout, stderr, cwd, tty, opts)
	if err != nil {
		if !tty {
			drainStdin(stdin)
		}
		fmt.Fprintf(stderr, "%s\n", err)
		return 1
	}
	return code
}

func runCLI(
	args []string,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
	cwd string,
	tty bool,
	opts CLIOptions,
) (int, error) {
	parsed, err := parseArgs(args)
	if err != nil {
		return 0, err
	}
	if parsed.help {
		fmt.Fprintf(stdout, "%s\n", usageText)
		if !tty {
			drainStdin(stdin)
		}
		return 0, nil
	}

	if len(opts.ProvidedSkillIDs) > 0 && len(opts.ProvidedInputs) == 0 {
		return 0, errors.New("Preset skill ids require preset install inputs.")
	}
	if len(opts.ProvidedSkillIDs) > 0 && len(opts.ProvidedSkillIDs) != len(opts.ProvidedInputs) {
		return 0, errors.New("Preset skill id count must match preset install input count.")
	}
	if len(opts.ProvidedInputs) > 0 && len(parsed.inputPaths) > 0 {
		return 0, errors.New("PATH cannot be used when install input is preset.")
	}

	agent := parsed.agent
	scope := parsed.scope
	if agent == "" || scope == "" {
		if !tty {
			return 0, fmt.Errorf("Missing required flags.\n%s", usageText)
		}
		reader := bufio.NewReader(stdin)
		if agent == "" {
			agent, err = promptAgent(reader, stderr)
			if err != nil {
				return 0, err
			}
		} else if agent, err = AssertAgent(agent); err != nil {
			return 0, err
		}
		if scope == "" {
			scope, err = promptScope(reader, stderr, agent)
			if err != nil {
				return 0, err
			}
		}
	}

	if agent, err = AssertAgent(agent); err != nil {
		return 0, err
	}
	if scope, err = AssertScope(scope); err != nil {
		return 0, err
	}
	if err := AssertSupportedAgentScopes([]string{agent}, []string{scope}); err != nil {
		return 0, err
	}

	sources, err := resolveInstallSources(
		parsed.inputPaths, stdin, tty, opts.ProvidedInputs, opts.ProvidedSkillIDs, cwd,
	)
	if err != nil {
		return 0, err
	}

	plan, err := buildInstallPlan(sources, agent, scope, cwd)
	if err != nil {
		return 0, err
	}
	if err := assertNoInstallCollisions(plan); err != nil {
		return 0, err
	}

	for _, item := range plan {
		result, installErr := InstallSkill(item.source.input, InstallOptions{
			Agent: item.agent,
			Scope: item.scope,
			Cwd:   cwd,
			Force: parsed.force,
		})
		if installErr != nil {
			return 0, installErr
		}
		fmt.Fprintf(stderr, "Installed %s to %s (%s/%s)\n",
			result.SkillID, result.InstalledTo, item.agent, item.scope)
	}
	return 0, nil
}
