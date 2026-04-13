package router

import (
	"embed"
	"io/fs"
)

// staticFiles holds the embedded frontend build output.
// This will be populated at build time when the frontend is built
// and placed in the static/ directory.
// During development, this will be nil and the router falls back to
// serving from frontend/dist/ on disk.

//go:embed all:static
var embeddedFiles embed.FS

var staticFiles fs.FS = embeddedFiles
