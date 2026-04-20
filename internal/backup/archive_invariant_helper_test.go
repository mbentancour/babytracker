package backup

import (
	"os"
	"testing"
)

func readBackupSource(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile("backup.go")
	if err != nil {
		t.Fatalf("read backup.go: %v", err)
	}
	return string(data)
}
