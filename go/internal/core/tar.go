package core

// Hand-rolled deterministic POSIX ustar writer. archive/tar is deliberately
// NOT used here: the export stream must be byte-identical to the reference
// implementation per docs/DETERMINISTIC_TAR.md.

import (
	"fmt"
	"io"
	"io/fs"
	"strconv"
)

const tarBlockSize = 512

func writeZeroPaddedOctal(dst []byte, value int64, digits int) {
	s := strconv.FormatInt(value, 8)
	if len(s) > digits {
		s = s[len(s)-digits:]
	}
	for i := 0; i < digits-len(s); i++ {
		dst[i] = '0'
	}
	copy(dst[digits-len(s):], s)
}

// octalSpaceNul encodes "%06o \x00" into an 8-byte field.
func octalSpaceNul(dst []byte, value int64) {
	writeZeroPaddedOctal(dst[:6], value, 6)
	dst[6] = ' '
	dst[7] = 0
}

// octalSpace encodes "%011o " into a 12-byte field (no trailing NUL).
func octalSpace(dst []byte, value int64) {
	writeZeroPaddedOctal(dst[:11], value, 11)
	dst[11] = ' '
}

func makeTarHeader(entry TarEntry) ([]byte, error) {
	if len(entry.Name) > 100 {
		return nil, fmt.Errorf("Tar entry name too long: %s", entry.Name)
	}

	buf := make([]byte, tarBlockSize)
	copy(buf[0:100], entry.Name)
	octalSpaceNul(buf[100:108], entry.Mode&0o777) // mode
	octalSpaceNul(buf[108:116], 0)                // uid
	octalSpaceNul(buf[116:124], 0)                // gid
	size := entry.Size
	if entry.IsDir {
		size = 0
	}
	octalSpace(buf[124:136], size) // size
	octalSpace(buf[136:148], 0)    // mtime (fixed epoch 0)
	copy(buf[148:156], "        ") // chksum computed below
	if entry.IsDir {
		buf[156] = '5'
	} else {
		buf[156] = '0'
	}
	copy(buf[257:263], "ustar\x00")
	copy(buf[263:265], "00")
	octalSpaceNul(buf[329:337], 0) // devmajor
	octalSpaceNul(buf[337:345], 0) // devminor

	var sum int64
	for _, b := range buf {
		sum += int64(b)
	}
	octalSpaceNul(buf[148:156], sum)

	return buf, nil
}

// WriteTar emits the deterministic tar stream for pre-collected entries.
func WriteTar(w io.Writer, skillFS fs.FS, entries []TarEntry) error {
	for _, entry := range entries {
		header, err := makeTarHeader(entry)
		if err != nil {
			return err
		}
		if _, err := w.Write(header); err != nil {
			return err
		}
		if entry.IsDir {
			continue
		}

		file, err := skillFS.Open(entry.Rel)
		if err != nil {
			return err
		}
		written, err := io.Copy(w, file)
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		if written != entry.Size {
			return fmt.Errorf("File size changed during export: %s", entry.Name)
		}
		if rem := entry.Size % tarBlockSize; rem != 0 {
			if _, err := w.Write(make([]byte, tarBlockSize-rem)); err != nil {
				return err
			}
		}
	}

	_, err := w.Write(make([]byte, 2*tarBlockSize))
	return err
}

// ExportSkill collects entries for a skill and writes the deterministic tar
// stream to w.
func ExportSkill(skillFS fs.FS, id string, normalizeModes bool, w io.Writer) error {
	entries, _, err := CollectSkillEntries(skillFS, id, normalizeModes)
	if err != nil {
		return err
	}
	return WriteTar(w, skillFS, entries)
}
