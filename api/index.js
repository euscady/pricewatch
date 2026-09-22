// Single Express app handling everything under /api — Vercel routes all
// /api/* requests here via the rewrite in vercel.json, and Express does the
// actual sub-routing (/api/auth/..., /api/products/...) from there.

const express = require('express');
const cookieSession = require('cookie-session');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');

const app = express();

app.use(express.json());
app.use(
  cookieSession({
    name: 'pw_session',
    secret: process.env.SESSION_SECRET,
    maxAge: 90 * 24 * 60 * 60 * 1000 // 90 days
  })
);

// Single-user mode: while there's no real sign-up flow wired into the UI
// yet, every request acts as the seeded default user (id 1). Once the
// sign-up/login screens are hooked up in the front end, swap this for the
// `requireAuth` check below on the product routes.
app.use((req, res, next) => {
  req.userId = (req.session && req.session.userId) || 1;
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

module.exports = app;
