# TruOffers.co.uk

The UK takeaway offers search engine — customers search live offers by postcode; takeaways get
found without paying marketplace commission. Built from the July 2026 business plan & product
blueprint (MVP scope).

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Frontend | Next.js 16 (App Router, TypeScript, Tailwind 4)             |
| Backend  | NestJS 10 + Mongoose (JWT auth, role guards, class-validator) |
| Database | MongoDB (`truoffers` db, 2dsphere geo index for postcode search) |

## Run it

MongoDB must be running on `localhost:27017` (ServBay's MongoDB works as-is).

```bash
# 1. Backend (port 4000)
cd backend
npm install
npm run seed          # wipes + seeds demo data (idempotent, dev only)
npm run start:dev     # API at http://localhost:4000/api

# 2. Frontend (port 3000)
cd frontend
npm install
npm run dev           # http://localhost:3000
```

## Demo logins (password for all: `Password123!`)

| Role           | Email                     | What to try                                            |
| -------------- | ------------------------- | ------------------------------------------------------ |
| Super admin    | admin@truoffers.co.uk     | `/admin` — executive dashboard, claim & offer queues   |
| Business owner | owner@bellanapoli.co.uk   | `/dashboard` — analytics, offer manager, billing (Professional plan) |
| Customer       | customer@example.com      | Follow takeaways, save offers                          |
| Supplier       | sales@packright.co.uk     | `/dashboard` — lead inbox                              |

## What's implemented (blueprint → code)

- **Search (§7.1, §10)** — postcode → geocode (postcodes.io + offline fallback) → `$geoNear`
  business lookup → live offers ranked by distance + trust score + rating. Cuisine, delivery/
  collection and verified-only filters.
- **Offer flip cards (§20)** — front shows the deal; tap flips to redemption details (code copy,
  show-in-store, direct link, phone), exactly as the wireframe.
- **Redemption system (§9)** — all 6 offer types, per-session/user dedupe, redemption caps with
  auto-expiry, expiry dates.
- **Claim & verification (§8)** — search your listing → claim via phone OTP (instant, dev code
  shown in UI), document upload (admin review) or Foodbell auto-verify. Badge levels: claimed /
  verified / Foodbell verified.
- **Moderation (§21)** — offers from unverified businesses enter the admin queue; verified
  businesses publish instantly. Admin approve/reject with notes.
- **Plans & billing (§6)** — all 5 takeaway plans + 3 supplier plans seeded with blueprint pricing
  and limits (Free = 2 live offers, Starter = 5, Standard+ unlimited — enforced server-side).
  Checkout is Stripe-ready: without `STRIPE_SECRET_KEY` it runs in mock mode.
- **Analytics (§16)** — full event taxonomy (`postcode_search`, `offer_impression`, `offer_flip`,
  `order_click`, …) fired from the UI, aggregated into the owner dashboard (with §16.4 funnel
  formulas) and the admin executive dashboard (MRR, ARPA, supply/demand, top search areas).
- **Supplier marketplace (§7.3)** — supplier directory + profiles, quote-request leads, supplier
  lead inbox with status pipeline.
- **Foodbell hooks (§27)** — `isFoodbellClient` flag, Foodbell-verified badge, order links tracked
  via `order_click` events.
- **SEO pages (§17.2)** — town pages (`/takeaways/{town}`), business profiles
  (`/takeaway/{slug}`), category pages, per-page metadata.
- **Real Stripe checkout + webhooks** — with `STRIPE_SECRET_KEY` set, plan checkout and wallet
  top-ups redirect to Stripe Checkout; `POST /api/billing/webhook` (signature-verified, raw body)
  activates subscriptions, credits wallets, and handles cancellations/payment failures. Without a
  key everything still runs in mock mode.
- **Promoted placements / ad wallet** — prepaid wallet per business (top up via Stripe or mock),
  flat daily-rate promotions for the whole business or a single offer. Active promotions get a
  ranking boost + "Sponsored" tag in search; an hourly cron charges the daily rate and auto-pauses
  when the balance runs out. Dashboard → **Promote** tab.
- **AI offer writer** — `POST /api/ai/offer-writer` drafts title/description/terms/label with
  Claude (`@anthropic-ai/sdk`, structured outputs) when `ANTHROPIC_API_KEY` is set; falls back to
  solid templates otherwise. Plan-gated (Professional+). "✨ Write it for me" in the offer form.
- **QR codes** — `GET /api/qr/business/{slug}.png` and `/api/qr/offer/{id}.png` render print-ready
  QR codes linking to the public pages (`?src=qr` for attribution). Download buttons in the
  dashboard (Promote tab + per-offer).
- **Google review sync** — with `GOOGLE_PLACES_API_KEY` set, a nightly cron (and a manual
  `POST /api/businesses/{id}/sync-reviews`) resolves each business's Google Place ID and refreshes
  its rating/review count. Disabled cleanly without the key.
- **Map view** — List/Map toggle on `/offers` renders nearby takeaways on an OpenStreetMap
  (Leaflet) map — sponsored businesses get highlighted markers. No map API key needed.
- **Franchise dashboards** — owners with multiple locations get an **All locations** tab:
  cross-location totals + a per-location comparison table
  (`GET /api/businesses/mine/stats`).

## Not yet built (per roadmap §19: V1.5+)

Mobile apps (native iOS/Android).

## Social login (Google & Apple)

The login/register pages include "Continue with Google/Apple". The frontend only sends the
provider's **ID token**; the backend verifies it server-side (Google tokeninfo / Apple JWKS via
`jose`) and issues a TruOffers JWT, auto-creating the account on first sign-in.

To activate: create a Google OAuth client ID and/or an Apple Services ID, then set
`GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` in `backend/.env` **and** the matching
`NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_APPLE_CLIENT_ID` in `frontend/.env.local`.
Until then the buttons show a "not configured" notice. `GET /api/auth/providers` reports what's
enabled.

## Hardening & best practices in place

- **Security**: helmet headers, rate limiting (100 req/min per IP, 10/min on auth endpoints,
  analytics exempt), JWT-secret guard that refuses to boot production with the dev secret,
  server-side plan-limit enforcement, OAuth tokens verified server-side only.
- **Background jobs** (§22): cron expires ended offers every 10 min, reconciles
  `activeOfferCount` hourly, charges promotion daily rates hourly (deduped to once per 24h),
  and syncs Google reviews nightly (batched to respect Places API quotas).
- **Ops**: `GET /api/health` (DB state + uptime), graceful shutdown hooks, `.env.example` files.
- **SEO** (§17.2): `sitemap.xml` (static + town + business pages), `robots.txt` (dashboards
  disallowed), OpenGraph metadata with title template, schema.org Restaurant/Offer JSON-LD on
  business profiles.
- **UX resilience**: branded 404 and error pages, global loading state, stale-token auto-logout
  on 401.

## Environment

- `backend/.env` — port, Mongo URI, JWT secret, optional Stripe / OAuth / Google Places /
  Anthropic keys (see `.env.example`). All optional keys degrade gracefully when blank.
- `frontend/.env.local` — `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, optional OAuth client IDs.
