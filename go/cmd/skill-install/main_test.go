package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestHelpRouting(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	code := run([]string{"--help"}, strings.NewReader(""), stdout, stderr)
	if code != 0 || stderr.Len() != 0 {
		t.Fatalf("code=%d stderr=%q", code, stderr.String())
	}
	if !strings.HasPrefix(stdout.String(), "Usage:\n  skill-install") {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestMissingFlagsRouting(t *testing.T) {
	stdout := &bytes.Buffer{}
	stderr := &bytes.Buffer{}
	code := run(nil, strings.NewReader(""), stdout, stderr)
	if code != 1 {
		t.Fatalf("code = %d", code)
	}
	if !strings.HasPrefix(stderr.String(), "Missing required flags.\nUsage:") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}
