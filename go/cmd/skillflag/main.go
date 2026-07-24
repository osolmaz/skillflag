// Command skillflag is the standalone Skillflag producer binary. Its
// default skills root is the bundled skillflag skill; the
// SKILLFLAG_SKILLS_ROOT environment variable (an OS path-list of skills
// roots) replaces it for conformance testing. `skillflag install ...`
// routes directly to the installer CLI.
package main

import (
	"io"
	"os"
	"path/filepath"

	"github.com/osolmaz/skillflag/go/internal/install"
	"github.com/osolmaz/skillflag/go/skillflag"
)

func run(argv []string, skillsRootEnv string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	if len(argv) > 1 && argv[1] == "install" {
		return install.RunCLI(argv[2:], install.CLIOptions{
			Stdin:  stdin,
			Stdout: stdout,
			Stderr: stderr,
		})
	}

	opts := skillflag.Options{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
	}
	if skillsRootEnv != "" {
		opts.SkillsRoots = filepath.SplitList(skillsRootEnv)
		opts.IncludeBundledSkill = skillflag.Bool(false)
	}
	return skillflag.Handle(argv, opts)
}

func main() {
	os.Exit(run(os.Args, os.Getenv("SKILLFLAG_SKILLS_ROOT"), os.Stdin, os.Stdout, os.Stderr))
}
