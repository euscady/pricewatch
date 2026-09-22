# Pricewatch — deployment guide (Vercel + Neon)

The real backend behind the Pricewatch design: fetches each tracked product
page once a day, has Claude read it and extract price/stock/sale
status/image, and logs it so the trend graphs in the UI are real history
instead of mock data.

This version is built for Vercel (hosting + cron) and Neon (Postgres),
both free for this scale of personal use.

## What you need before starting

1. **A Vercel account** — [vercel.com](https://vercel.com), sign up with
   GitHub (makes deploys automatic on every push).
2. **A Neon account** — [neon.com](https://neon.com), sign up, create a new
   project. Free tier is plenty for this.
3. **An Anthropic API key** — [console.anthropic.com](https://console.anthropic.com),
   Settings → API Keys. Add some usage credits while you're there (the
   console will prompt you — $20 is a reasonable amount to start testing
   the daily checks over a couple of weeks).
4. **A GitHub account**, to hold the code Vercel deploys from.

## 1. Push this project to GitHub

If you don't already have this in a repo:

```bash
cd pricewatch-vercel
git init
git add .
git commit -m "Initial Pricewatch build"
```

Create a new repository on GitHub (empty, no README/license), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/pricewatch.git
git push -u origin main
```

## 2. Create the Neon database

In the Neon console, open your project's **SQL Editor** and paste in the
contents of `schema.sql` from this project, then run it. That creates the
tables and seeds one default user.

Grab your connection string from the Neon dashboard (**Connect** button) —
it looks like `postgresql://user:password@ep-xxxx.neon.tech/neondb?sslmode=require`.
You'll need it in the next step.

Optional: open the `users` table (Neon's **Tables** view, or any Postgres
client) and update the seeded row's `email` to whatever you want to log in
with later.

## 3. Deploy to Vercel

- Go to [vercel.com/new](https://vercel.com/new), import the GitHub repo
  you just pushed.
- Vercel will detect it as a plain Node project — no build settings to
  change.
- Before clicking Deploy, add these **Environment Variables**:
  - `DATABASE_URL` → the Neon connection string from step 2
  - `ANTHROPIC_API_KEY` → your API key
  - `SESSION_SECRET` → any long random string
  - `CRON_SECRET` → a different long random string (this is what stops
    random people from triggering your daily check by hitting the URL
    directly)
- Click **Deploy**.

Once it's live, visit the URL Vercel gives you. You should see the
Pricewatch onboarding screen. Click through — the list will be empty until
you add a product.

## 4. The daily check is already wired up

Unlike shared hosting, there's no separate cron setup step — `vercel.json`
in this project already declares the schedule:

```json
"crons": [{ "path": "/api/cron/check-prices", "schedule": "0 13 * * *" }]
```

That's 13:00 UTC, which is roughly 9am Eastern (adjusts automatically for
daylight saving since it's a fixed UTC time — you'll see it land around
8-9am depending on the time of year). Vercel starts running it automatically
once deployed. Note Vercel's free Hobby plan restricts cron timing to
"sometime within that hour," not the exact minute — fine for a daily price
check, not something to build a stricter schedule around without upgrading.

You can trigger it manually anytime to test: visit
`https://your-app.vercel.app/api/cron/check-prices` with the header
`Authorization: Bearer YOUR_CRON_SECRET` (a tool like Postman, curl, or a
browser extension that sets headers). Vercel's own dashboard also shows you
cron run history and logs under your project's **Cron Jobs** tab, so you
can confirm it's actually firing without needing to test it manually.

## Testing a product link

Paste any retailer product page URL into the app. The first check runs
immediately, so you'll see right away whether it worked. If it says
"Couldn't read a product page at that link," a few things can cause that:

- The retailer blocks non-browser traffic (Amazon is the most aggressive
  about this — see below).
- The price is loaded entirely by client-side JavaScript, so it's not
  present in the raw HTML this app fetches.
- The page structure is unusual enough that the model couldn't confidently
  identify a price.

## About Amazon specifically

Amazon blocks scraping-style requests harder than most retailers. If you're
tracking a lot of Amazon links and hitting failures, the real fix is their
official [Product Advertising API](https://webservices.amazon.com/paapi5/documentation/)
(free, but requires an Amazon Associates account and approval) — a separate
integration from what's built here, worth doing once you know this is a
tool you'll keep using.

## About headless-browser scraping

Some sites render their price entirely in JavaScript with nothing useful in
the initial HTML. The real fix is a headless browser (Playwright) that
actually runs the page's JS before reading it. Vercel serverless functions
*can* run this (unlike shared hosting), but it needs a Chromium binary
bundled for the function, which is a meaningfully heavier setup — worth
adding only once you've confirmed which specific sites need it, rather than
building it in speculatively.

## Multi-retailer links ("available at 3 other stores")

The `product_links` table is ready for this, but nothing populates it yet
— matching "this exact product" across other retailers automatically is a
genuinely hard problem (search + verify it's the same item, not a similar
one). For now you can add rows manually via Neon's table view to test the
UI, or ask me to build the automated matching (using Claude's web search)
once the core daily-tracking loop has been running reliably.

## Adding real login (multi-user)

Right now the app runs in single-user mode — every request acts as the one
seeded account, no login screen. The backend for real accounts already
exists (`api/routes/auth.js` — signup/login/logout, passwords hashed with
bcrypt), it's just not wired into the front end yet. When you're ready to
open this up to other people, that's a front-end task (a login screen, plus
removing the "default to user 1" fallback in `api/index.js`) — say the word.

## Costs to expect

Vercel and Neon: free at this scale, per their published limits (once-daily
cron, small database, low traffic — all well inside the free Hobby/Free
tiers).

Claude API usage: `api/scraper.js` checks each page for structured product
data (JSON-LD or Open Graph/product meta tags) first — most mainstream
retailers embed this for Google Shopping, so most daily checks read price,
stock and image straight from the page with zero API calls. Claude is only
called as a fallback, for the rare page with no structured data at all. For
two people tracking a normal mix of mainstream retailers, expect this to
stay close to free — worth checking
[console.anthropic.com](https://console.anthropic.com) usage after the
first week to see how often your actual links need the fallback.
