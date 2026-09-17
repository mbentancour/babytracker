package config

import (
	"net/url"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// A password with "@" in it, as docker-compose interpolates POSTGRES_PASSWORD,
// must reach pgx (libpq-style parsing) and net/url (migrations, backups) as
// the same host and password.
func TestEscapeUserinfoAtPasswordWithAt(t *testing.T) {
	for _, raw := range []string{
		"postgres://babytracker:pa@ss@db:5432/babytracker?sslmode=prefer",
		"postgresql://babytracker:p@a@ss@db:5432/babytracker",
	} {
		escaped := escapeUserinfoAt(raw)

		cfg, err := pgconn.ParseConfig(escaped)
		if err != nil {
			t.Fatalf("pgconn.ParseConfig(%q): %v", escaped, err)
		}
		u, err := url.Parse(escaped)
		if err != nil {
			t.Fatalf("url.Parse(%q): %v", escaped, err)
		}
		want, _ := url.Parse(raw)
		wantPW, _ := want.User.Password()
		gotPW, _ := u.User.Password()

		if cfg.Host != "db" || u.Hostname() != "db" {
			t.Errorf("%q: pgx host %q, net/url host %q, want db", raw, cfg.Host, u.Hostname())
		}
		if cfg.Password != wantPW || gotPW != wantPW {
			t.Errorf("%q: pgx password %q, net/url password %q, want %q", raw, cfg.Password, gotPW, wantPW)
		}
	}
}

func TestEscapeUserinfoAtLeavesOtherURLsAlone(t *testing.T) {
	for _, raw := range []string{
		"postgres://babytracker:babytracker@localhost:5432/babytracker?sslmode=prefer",
		"postgres://babytracker:pa%40ss@db:5432/babytracker",
		"postgres://babytracker@/babytracker?host=/run/postgresql&sslmode=disable",
		"postgres://db/babytracker?options=a@b@c",
		"postgres://localhost/babytracker",
		"host=db user=babytracker password=pa@ss",
	} {
		if got := escapeUserinfoAt(raw); got != raw {
			t.Errorf("escapeUserinfoAt(%q) = %q, want unchanged", raw, got)
		}
	}
}
