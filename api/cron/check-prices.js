// Vercel Cron hits this as a plain GET request once a day (see the
// schedule in vercel.json). Vercel automatically sends
// `Authorization: Bearer <CRON_SECRET>` on cron-triggered requests when
// CRON_SECRET is set as an environment variable — that's what stops
// anyone else from hitting this URL and forcing a run.

const { db } = require('../db');
const { checkProduct } = require('../scraper');

module.exports = async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const sql = db();
  const products = await sql.query(
    `SELECT p.id, p.url, u.preferred_model, u.preferred_effort
     FROM products p JOIN users u ON u.id = p.user_id
     WHERE p.status != 'paused'`
  );

  const results = [];

  for (const product of products) {
    try {
      const info = await checkProduct(product.url, {
        model: product.preferred_model,
        effort: product.preferred_effort
      });

      if (!info.found) {
        await sql.query('UPDATE products SET status = $1, last_error = $2 WHERE id = $3', [
          'error',
          "Couldn't read a product page at that link on this check.",
          product.id
        ]);
        results.push({ id: product.id, ok: false, reason: 'page unreadable' });
        continue;
      }

      await sql.query(
        'INSERT INTO price_checks (product_id, price, currency, in_stock, on_sale) VALUES ($1, $2, $3, $4, $5)',
        [product.id, info.price ?? null, info.currency || 'USD', info.in_stock, info.on_sale]
      );
      await sql.query(
        'UPDATE products SET status = $1, last_error = NULL, name = COALESCE($2, name), image_url = COALESCE($3, image_url) WHERE id = $4',
        ['active', info.title || null, info.image_url || null, product.id]
      );
      results.push({ id: product.id, ok: true, price: info.price, in_stock: info.in_stock });
    } catch (err) {
      await sql.query('UPDATE products SET status = $1, last_error = $2 WHERE id = $3', ['error', String(err.message).slice(0, 500), product.id]);
      results.push({ id: product.id, ok: false, reason: err.message });
    }
  }

  res.status(200).json({ checked: results.length, results });
};
