package backup

import (
	"strings"
	"testing"
)

// TestArchiveBuilderSourceCodeInvariant is a guard for the SECURITY INVARIANT
// documented on BuildArchive: the archive must never include .jwt_secret.
//
// We can't easily run BuildArchive in a unit test (it shells out to pg_dump
// against a live database), so instead we assert that the archive-builder
// source doesn't reference .jwt_secret at all. If someone later adds a code
// path that stages that file into the archive, this test will fail.
func TestArchiveBuilderSourceCodeInvariant(t *testing.T) {
	// Inline the file path via a runtime read so the test stays stable even
	// if the module path changes.
	data := readBackupSource(t)
	if strings.Contains(data, ".jwt_secret") {
		t.Errorf("backup.go must not reference .jwt_secret — that file must never end up in a backup archive")
	}
}
