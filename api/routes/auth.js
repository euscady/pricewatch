const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');

const router = express.Router();

// POST /api/auth/signup { email, password }
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and an 8+ character password are required.' });
  }
  const sql = db();
  const existing = await sql.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.length) return res.status(409).json({ error: 'An account with that email already exists.' });

  const hash = await bcrypt.hash(password, 10);
  const rows = await sql.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id', [email, hash]);
  req.session.userId = rows[0].id;
  res.status(201).json({ id: rows[0].id, email });
});

// POST /api/auth/login { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const sql = db();
  const rows = await sql.query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  if (!rows.length) return res.status(401).json({ error: 'Incorrect email or password.' });

  const ok = await bcrypt.compare(password || '', rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

  req.session.userId = rows[0].id;
  res.json({ id: rows[0].id, email });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session = null;
  res.status(204).end();
});

// GET /api/auth/me — current user + model/effort preference.
// Uses req.userId (set in api/index.js — defaults to the seeded user 1
// while there's no login flow in the UI yet, and to the real logged-in
// user once there is).
router.get('/me', async (req, res) => {
  const sql = db();
  const rows = await sql.query('SELECT id, email, preferred_model, preferred_effort FROM users WHERE id = $1', [req.userId]);
  if (!rows.length) return res.status(404).json({ error: 'User not found' });
  res.json(rows[0]);
});

// PATCH /api/auth/me { preferred_model, preferred_effort } — the bottom bar picker writes here.
router.patch('/me', async (req, res) => {
  const { preferred_model, preferred_effort } = req.body;
  const sql = db();
  await sql.query('UPDATE users SET preferred_model = $1, preferred_effort = $2 WHERE id = $3', [preferred_model, preferred_effort, req.userId]);
  res.status(204).end();
});

module.exports = router;
