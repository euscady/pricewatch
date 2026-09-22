// Neon's serverless Postgres driver — works over HTTP/WebSocket, which fits
// Vercel's serverless functions much better than a long-lived connection
// pool would (each function invocation is short-lived).
const { neon } = require('@neondatabase/serverless');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — every database call will fail. Check your Vercel project\'s Environment Variables.');
}

let rawSql;
function db() {
  if (!rawSql) {
    rawSql = neon(process.env.DATABASE_URL);
  }
  // Wrapped so a genuinely unreachable database fails fast (10s) with a
  // clear error, instead of leaving the request hanging until Vercel's
  // whole-function timeout kills it with no explanation.
  return {
    query(text, params) {
      return Promise.race([
        rawSql.query(text, params),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database did not respond within 10s — check DATABASE_URL in your Vercel project settings.')), 10000)
        )
      ]);
    }
  };
}

module.exports = { db };
