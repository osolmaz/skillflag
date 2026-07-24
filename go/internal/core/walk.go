package core

import (
	"fmt"
	"io/fs"
	"sort"
	"strings"
)

// TarEntry is one entry of the deterministic export stream.
type TarEntry struct {
	// Name is the full tar entry name (directories end with "/").
	Name string
	// IsDir marks directory entries.
	IsDir bool
	// Mode is the permission bits to encode (already masked with 0o777).
	Mode int64
	// Size is the file size in bytes (0 for directories).
	Size int64
	// Rel is the path of the entry within the skill filesystem ("." for the
	// skill root directory).
	Rel string
}

func isInvalidExportRelPath(relPosix string) bool {
	if strings.HasPrefix(relPosix, "/") {
		return true
	}
	for _, part := range strings.Split(relPosix, "/") {
		if part == ".." {
			return true
		}
	}
	return false
}

// skillWalker accumulates the directory and file entries of one skill.
type skillWalker struct {
	skillFS        fs.FS
	id             string
	normalizeModes bool
	dirRels        []string
	files          []TarEntry
}

func (w *skillWalker) walkDir(rel string) error {
	w.dirRels = append(w.dirRels, rel)
	dirPath := "."
	if rel != "" {
		dirPath = rel
	}
	dirents, err := fs.ReadDir(w.skillFS, dirPath)
	if err != nil {
		return err
	}

	for _, dirent := range dirents {
		relChild := dirent.Name()
		if rel != "" {
			relChild = rel + "/" + relChild
		}
		if isInvalidExportRelPath(relChild) {
			return fmt.Errorf("Invalid path in skill: %s/%s", w.id, relChild)
		}
		if err := w.visitDirent(dirent, relChild); err != nil {
			return err
		}
	}
	return nil
}

func (w *skillWalker) visitDirent(dirent fs.DirEntry, relChild string) error {
	switch {
	case dirent.IsDir():
		return w.walkDir(relChild)
	case dirent.Type().IsRegular():
		return w.addFile(dirent, relChild)
	case dirent.Type()&fs.ModeSymlink != 0:
		return fmt.Errorf("Symlinks are not supported in skill bundles: %s/%s", w.id, relChild)
	default:
		return fmt.Errorf("Unsupported file type in skill bundle: %s/%s", w.id, relChild)
	}
}

func (w *skillWalker) addFile(dirent fs.DirEntry, relChild string) error {
	info, err := dirent.Info()
	if err != nil {
		return err
	}
	mode := int64(info.Mode().Perm())
	if w.normalizeModes {
		mode = 0o644
	}
	w.files = append(w.files, TarEntry{
		Name: w.id + "/" + relChild,
		Mode: mode,
		Size: info.Size(),
		Rel:  relChild,
	})
	return nil
}

func (w *skillWalker) dirEntries() ([]TarEntry, error) {
	entries := make([]TarEntry, 0, len(w.dirRels))
	for _, rel := range w.dirRels {
		statPath := "."
		name := w.id + "/"
		if rel != "" {
			statPath = rel
			name = w.id + "/" + rel + "/"
		}
		mode := int64(0o755)
		if !w.normalizeModes {
			info, err := fs.Stat(w.skillFS, statPath)
			if err != nil {
				return nil, err
			}
			mode = int64(info.Mode().Perm())
		}
		entries = append(entries, TarEntry{Name: name, IsDir: true, Mode: mode, Rel: statPath})
	}
	return entries, nil
}

// CollectSkillEntries walks a skill directory and returns its tar entries
// sorted byte-wise by entry name, plus the number of regular files.
func CollectSkillEntries(skillFS fs.FS, id string, normalizeModes bool) ([]TarEntry, int, error) {
	walker := &skillWalker{skillFS: skillFS, id: id, normalizeModes: normalizeModes}
	if err := walker.walkDir(""); err != nil {
		return nil, 0, err
	}

	entries, err := walker.dirEntries()
	if err != nil {
		return nil, 0, err
	}
	entries = append(entries, walker.files...)

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return entries, len(walker.files), nil
}
