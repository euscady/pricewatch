const express = require('express');
const { db } = require('../db');
const { checkProduct } = require('../scraper');

const router = express.Router();

// All routes here assume a single logged-in user (req.userId), set by the
// auth middleware in api/index.js.

// GET /api/products — list every tracked product with its latest and
// previous check, for the list view.
router.get('/', async (req, res) => {
  const sql = db();
  const products = await sql.query(
    `SELECT id, name, retailer, image_url, status, last_error, url
     FROM products WHERE user_id = $1 ORDER BY created_at DESC`,
    [req.userId]
  );

  for (const p of products) {
    const checks = await sql.query(
      `SELECT price, currency, in_stock, on_sale, checked_at
       FROM price_checks WHERE product_id = $1 ORDER BY checked_at DESC LIMIT 2`,
      [p.id]
    );
    p.latest = checks[0] || null;
    p.previous = checks[1] || null;
  }

  res.json({ products });
});

// POST /api/products { url } — start tracking a new product. Runs the
// first check immediately so the row isn't empty while waiting for
// tomorrow's cron run.
router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Paste a full product link (starting with http:// or https://).' });
  }

  const sql = db();
  const inserted = await sql.query(
    'INSERT INTO products (user_id, url, status) VALUES ($1, $2, $3) RETURNING id',
    [req.userId, url, 'active']
  );
  const productId = inserted[0].id;

  try {
    const userRows = await sql.query('SELECT preferred_model, preferred_effort FROM users WHERE id = $1', [req.userId]);
    const { preferred_model, preferred_effort } = userRows[0];

    const info = await checkProduct(url, { model: preferred_model, effort: preferred_effort });

    if (!info.found) {
      await sql.query('UPDATE products SET status = $1, last_error = $2 WHERE id = $3', ['error', "Couldn't read a product page at that link.", productId]);
      return res.status(200).json({ id: productId, warning: "Added, but couldn't read a product page at that link yet — it'll retry on tomorrow's check." });
    }

    await sql.query(
      'UPDATE products SET name = $1, retailer = $2, image_url = $3 WHERE id = $4',
      [info.title || null, info.retailer || null, info.image_url || null, productId]
    );
    await sql.query(
      'INSERT INTO price_checks (product_id, price, currency, in_stock, on_sale) VALUES ($1, $2, $3, $4, $5)',
      [productId, info.price ?? null, info.currency || 'USD', info.in_stock, info.on_sale]
    );

    res.status(201).json({ id: productId, info });
  } catch (err) {
    await sql.query('UPDATE products SET status = $1, last_error = $2 WHERE id = $3', ['error', String(err.message).slice(0, 500), productId]);
    res.status(201).json({ id: productId, warning: "Added, but the first check failed — it'll retry on tomorrow's check." });
  }
});

// GET /api/products/:id/history?range=week|month|year
router.get('/:id/history', async (req, res) => {
  const range = req.query.range === 'year' ? 365 : req.query.range === 'month' ? 30 : 7;
  const sql = db();

  const owns = await sql.query('SELECT id FROM products WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  if (!owns.length) return res.status(404).json({ error: 'Not found' });

  const rows = await sql.query(
    `SELECT price, currency, in_stock, on_sale, checked_at
     FROM price_checks
     WHERE product_id = $1 AND checked_at >= NOW() - ($2 || ' days')::interval
     ORDER BY checked_at ASC`,
    [req.params.id, range]
  );
  res.json({ history: rows });
});

// GET /api/products/:id/links — other retailers selling the same item, if any were found.
router.get('/:id/links', async (req, res) => {
  const sql = db();
  const rows = await sql.query('SELECT retailer, url, last_price FROM product_links WHERE product_id = $1', [req.params.id]);
  res.json({ links: rows });
});

// DELETE /api/products/:id — stop tracking.
router.delete('/:id', async (req, res) => {
  const sql = db();
  await sql.query('DELETE FROM products WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  res.status(204).end();
});

module.exports = router;
