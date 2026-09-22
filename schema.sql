-- Pricewatch database schema (Postgres / Neon).
-- Run this once against your Neon database — via the SQL Editor in the
-- Neon console (console.neon.tech), or `psql "$DATABASE_URL" -f schema.sql`.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  preferred_model VARCHAR(64) NOT NULL DEFAULT 'claude-sonnet-4-5',
  preferred_effort VARCHAR(16) NOT NULL DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  name VARCHAR(500),
  retailer VARCHAR(255),
  image_url TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'error'
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_checks (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price NUMERIC(10,2),
  currency VARCHAR(8) DEFAULT 'USD',
  in_stock BOOLEAN NOT NULL DEFAULT TRUE,
  on_sale BOOLEAN NOT NULL DEFAULT FALSE,
  checked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_price_checks_product_time ON price_checks (product_id, checked_at);

-- Other retailers selling the same product, for the "available at" links.
-- Not populated automatically yet — see README for why, and how it can be
-- extended later with Claude's web search.
CREATE TABLE IF NOT EXISTS product_links (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  retailer VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  last_price NUMERIC(10,2)
);

-- Seed a single default user so the app works immediately without a
-- sign-up flow. The password hash below is a placeholder — sign-up/login
-- endpoints exist in api/routes/auth.js but aren't wired into the UI yet
-- (see README "Adding real login").
INSERT INTO users (id, email, password_hash, preferred_model, preferred_effort)
VALUES (1, 'hello@euscady.com', '$2a$10$replace.with.a.real.bcrypt.hash', 'claude-sonnet-4-5', 'medium')
ON CONFLICT (id) DO NOTHING;

SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1));
