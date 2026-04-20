// Package version exposes the app's compile-time version string. The
// default is "dev" for local builds; releases set it via -ldflags.
package version

// Version is set at build time via:
//   go build -ldflags="-X 'github.com/mbentancour/babytracker/internal/version.Version=v1.6.0'"
var Version = "dev"
