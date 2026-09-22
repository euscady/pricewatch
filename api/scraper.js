// Checks a product page for price/stock/sale/image — free first, AI only
// as a last resort.
//
// Most retailer product pages already embed structured data (JSON-LD
// schema.org markup, or Open Graph / product meta tags) specifically so
// Google Shopping and search engines can read price and availability
// without AI. Step 1 reads that directly — it's free, fast, and doesn't
// depend on an LLM's judgment. Only when a page has none of that (no
// structured data at all) does this fall back to asking Claude to read the
// page like a person would. For two people tracking a normal mix of
// mainstream retailers, most checks should never need step 2 at all.

const Anthropic = require('@anthropic-ai/sdk');

let anthropic;
function client() {
  if (!anthropic) anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // don't hang the whole request forever on a slow/blocking site
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow',
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Page returned HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('That page took too long to respond (over 15s) — the site may be blocking automated requests.');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Step 1: free structured-data extraction ----------

function tryParseJson(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}

function flattenGraph(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => flattenGraph(n, out)); return; }
  if (node['@graph']) flattenGraph(node['@graph'], out);
  out.push(node);
}

function availabilityToStock(avail) {
  if (!avail) return null;
  const tail = String(avail).split('/').pop().toLowerCase();
  if (tail.includes('instock') || tail.includes('limitedavailability') || tail.includes('presale') || tail.includes('preorder')) return true;
  if (tail.includes('outofstock') || tail.includes('discontinued') || tail.includes('soldout')) return false;
  return null;
}

function extractFromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of blocks) {
    const json = tryParseJson(block[1].trim());
    if (!json) continue;
    const nodes = [];
    flattenGraph(json, nodes);
    const product = nodes.find((n) => {
      const type = n['@type'];
      return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
    });
    if (!product) continue;

    let offer = product.offers;
    if (Array.isArray(offer)) offer = offer[0];
    if (offer && offer.offers) offer = Array.isArray(offer.offers) ? offer.offers[0] : offer.offers;

    const price = offer ? Number(offer.price ?? offer.lowPrice) : null;
    if (price == null || isNaN(price)) continue; // not enough to trust this block

    const image = Array.isArray(product.image) ? product.image[0] : product.image;

    return {
      found: true,
      title: product.name || null,
      price,
      currency: (offer && (offer.priceCurrency)) || 'USD',
      in_stock: availabilityToStock(offer && offer.availability) ?? true,
      on_sale: false, // JSON-LD doesn't reliably expose a "was" price — left to the AI fallback if this matters for a given site
      original_price: null,
      image_url: image || null,
      retailer: product.brand && product.brand.name ? product.brand.name : null,
      method: 'structured-data'
    };
  }
  return null;
}

function metaContent(html, patterns) {
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractFromMetaTags(html, url) {
  const price = metaContent(html, [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["']/i,
    /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["']/i
  ]);
  if (!price || isNaN(Number(price))) return null;

  const currency = metaContent(html, [
    /<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+itemprop=["']priceCurrency["'][^>]+content=["']([^"']+)["']/i
  ]) || 'USD';

  const title = metaContent(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title>([^<]+)<\/title>/i
  ]);

  const image = metaContent(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
  ]);

  const availability = metaContent(html, [
    /<meta[^>]+property=["']product:availability["'][^>]+content=["']([^"']+)["']/i
  ]);

  let retailer = null;
  try { retailer = new URL(url).hostname.replace('www.', '').split('.')[0]; } catch (e) {}

  return {
    found: true,
    title: title || null,
    price: Number(price),
    currency,
    in_stock: availabilityToStock(availability) ?? true,
    on_sale: false,
    original_price: null,
    image_url: image || null,
    retailer,
    method: 'meta-tags'
  };
}

// ---------- Step 2: AI fallback, only when step 1 finds nothing ----------

const EXTRACT_TOOL = {
  name: 'record_product_info',
  description: 'Record the product details found on this page.',
  input_schema: {
    type: 'object',
    properties: {
      found: { type: 'boolean', description: 'False if this page clearly is not a single product page.' },
      title: { type: 'string' },
      price: { type: ['number', 'null'] },
      currency: { type: 'string' },
      in_stock: { type: 'boolean' },
      on_sale: { type: 'boolean' },
      original_price: { type: ['number', 'null'] },
      image_url: { type: ['string', 'null'] },
      retailer: { type: 'string' }
    },
    required: ['found', 'in_stock', 'on_sale']
  }
};

function stripHtml(html) {
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const LIMIT = 45000;
  if (cleaned.length > LIMIT) cleaned = cleaned.slice(0, LIMIT);
  return cleaned;
}

async function extractWithAI(html, url, opts) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // No key configured — the app still works, this link just can't be
    // read since it has no free structured data. Set ANTHROPIC_API_KEY
    // later if you start hitting this on links you actually care about.
    return { found: false, method: 'no-api-key-configured' };
  }

  const model = opts.model || 'claude-sonnet-4-5';
  const effort = opts.effort || 'medium';
  const thinkingBudget = effort === 'high' ? 4000 : effort === 'low' ? 0 : 1500;

  const message = await client().messages.create({
    model,
    max_tokens: 1024,
    ...(thinkingBudget > 0 ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
    tools: [EXTRACT_TOOL],
    tool_choice: { type: 'tool', name: 'record_product_info' },
    messages: [{
      role: 'user',
      content: `Here is the HTML of a retailer product page (scripts/styles stripped). Extract the current product info.\n\nURL: ${url}\n\nHTML:\n${stripHtml(html)}`
    }]
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Model did not return structured data');
  return { ...toolUse.input, method: 'ai-fallback' };
}

/**
 * Checks one product URL. Tries free structured-data extraction first;
 * only calls Claude if the page has none.
 * @param {string} url
 * @param {{model?: string, effort?: 'low'|'medium'|'high'}} opts
 */
async function checkProduct(url, opts = {}) {
  const html = await fetchPage(url);

  const structured = extractFromJsonLd(html) || extractFromMetaTags(html, url);
  if (structured) return structured;

  return extractWithAI(html, url, opts);
}

module.exports = { checkProduct };
