// Command skill-install implements the skill-install companion CLI: it
// installs a skill directory or a tar bundle from stdin into a target
// agent/scope destination.
package main

import (
	"io"
	"os"

	"github.com/osolmaz/skillflag/go/internal/install"
)

func run(args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	return install.RunCLI(args, install.CLIOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
	})
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}
