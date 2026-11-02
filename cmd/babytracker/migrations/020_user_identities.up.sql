-- Links a local account to an account at an OpenID Connect provider. Keyed by
-- the provider's issuer and its stable subject identifier, never by username
-- or email: those may be editable at the provider, and matching on them would
-- let someone who renames themselves there sign in as somebody else here.
CREATE TABLE user_identities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    UNIQUE (issuer, subject),
    -- One identity per provider per account; relinking replaces it.
    UNIQUE (user_id, issuer)
);
