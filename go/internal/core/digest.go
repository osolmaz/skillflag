package core

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
)

// DigestSkill computes "sha256:<hex>" over the exact export tar bytes.
func DigestSkill(skillFS fs.FS, entries []TarEntry) (string, error) {
	hash := sha256.New()
	if err := WriteTar(hash, skillFS, entries); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(hash.Sum(nil)), nil
}
