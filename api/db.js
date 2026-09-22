// Neon's serverless Postgres driver — works over HTTP/WebSocket, which fits
// Vercel's serverless functions much better than a long-lived connection
// pool would (each function invocation is short-lived).
const { neon } = require('@neondatabase/serverless');

let sql;
function db() {
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

module.exports = { db };
