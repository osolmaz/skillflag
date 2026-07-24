package core

import (
	"archive/tar"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
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

func exportFixture(t *testing.T, id string) []byte {
	t.Helper()
	skillFS, normalize, err := ResolveSkillFS([]Root{DiskRoot(fixturesRoot(t))}, id)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := ExportSkill(skillFS, id, normalize, &buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestExportAlphaStructure(t *testing.T) {
	data := exportFixture(t, "alpha")

	// Worked example from docs/DETERMINISTIC_TAR.md: 8 blocks total.
	if len(data) != 8*512 {
		t.Fatalf("stream length = %d, want %d", len(data), 8*512)
	}

	reader := tar.NewReader(bytes.NewReader(data))
	var names []string
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, header.Name)

		if header.Uid != 0 || header.Gid != 0 {
			t.Errorf("%s: uid/gid = %d/%d, want 0/0", header.Name, header.Uid, header.Gid)
		}
		if header.Uname != "" || header.Gname != "" {
			t.Errorf("%s: uname/gname = %q/%q, want empty", header.Name, header.Uname, header.Gname)
		}
		if header.ModTime.Unix() != 0 {
			t.Errorf("%s: mtime = %v, want epoch 0", header.Name, header.ModTime)
		}
		if strings.HasSuffix(header.Name, "/") && header.Typeflag != tar.TypeDir {
			t.Errorf("%s: typeflag = %q, want directory", header.Name, header.Typeflag)
		}
		if header.Name == "alpha/SKILL.md" {
			content, readErr := io.ReadAll(reader)
			if readErr != nil {
				t.Fatal(readErr)
			}
			disk, diskErr := os.ReadFile(filepath.Join(fixturesRoot(t), "alpha", "SKILL.md"))
			if diskErr != nil {
				t.Fatal(diskErr)
			}
			if !bytes.Equal(content, disk) {
				t.Error("SKILL.md content does not match disk")
			}
		}
	}

	want := []string{"alpha/", "alpha/SKILL.md", "alpha/templates/", "alpha/templates/hello.txt"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("entry names = %v, want %v", names, want)
	}
}

func TestExportDeterministic(t *testing.T) {
	first := exportFixture(t, "alpha")
	second := exportFixture(t, "alpha")
	if !bytes.Equal(first, second) {
		t.Fatal("two exports are not byte-identical")
	}
}

func TestDigestMatchesExportBytes(t *testing.T) {
	data := exportFixture(t, "alpha")
	sum := sha256.Sum256(data)
	want := "sha256:" + hex.EncodeToString(sum[:])

	skillFS, normalize, err := ResolveSkillFS([]Root{DiskRoot(fixturesRoot(t))}, "alpha")
	if err != nil {
		t.Fatal(err)
	}
	entries, fileCount, err := CollectSkillEntries(skillFS, "alpha", normalize)
	if err != nil {
		t.Fatal(err)
	}
	if fileCount != 2 {
		t.Fatalf("fileCount = %d, want 2", fileCount)
	}
	digest, err := DigestSkill(skillFS, entries)
	if err != nil {
		t.Fatal(err)
	}
	if digest != want {
		t.Fatalf("digest = %s, want %s", digest, want)
	}
}

func TestExportPreservesExecuteBits(t *testing.T) {
	dir := t.TempDir()
	skillDir := filepath.Join(dir, "tool")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(skillDir, "SKILL.md"), "---\nname: tool\ndescription: d\n---\n", 0o644)
	writeTestFile(t, filepath.Join(skillDir, "run.sh"), "#!/bin/sh\n", 0o755)

	skillFS, normalize, err := ResolveSkillFS([]Root{DiskRoot(dir)}, "tool")
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := ExportSkill(skillFS, "tool", normalize, &buf); err != nil {
		t.Fatal(err)
	}

	reader := tar.NewReader(bytes.NewReader(buf.Bytes()))
	found := false
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Name == "tool/run.sh" {
			found = true
			if header.Mode&0o111 == 0 {
				t.Errorf("run.sh mode %o lost execute bits", header.Mode)
			}
		}
	}
	if !found {
		t.Fatal("run.sh entry missing")
	}
}

func TestExportRejectsSymlinks(t *testing.T) {
	dir := t.TempDir()
	skillDir := filepath.Join(dir, "linked")
	if err := os.MkdirAll(skillDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(skillDir, "SKILL.md"), "---\nname: linked\ndescription: d\n---\n", 0o644)
	if err := os.Symlink("SKILL.md", filepath.Join(skillDir, "link.md")); err != nil {
		t.Fatal(err)
	}

	skillFS, normalize, err := ResolveSkillFS([]Root{DiskRoot(dir)}, "linked")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = CollectSkillEntries(skillFS, "linked", normalize)
	if err == nil || err.Error() != "Symlinks are not supported in skill bundles: linked/link.md" {
		t.Fatalf("err = %v", err)
	}
}

func TestTarHeaderNameTooLong(t *testing.T) {
	_, err := makeTarHeader(TarEntry{Name: strings.Repeat("a", 101)})
	if err == nil || !strings.HasPrefix(err.Error(), "Tar entry name too long:") {
		t.Fatalf("err = %v", err)
	}
}

func writeTestFile(t *testing.T, path string, content string, mode os.FileMode) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}
