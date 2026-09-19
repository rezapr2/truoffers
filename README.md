# TruOffers.co.uk

The UK takeaway offers search engine — customers search live offers by postcode; takeaways get
found without paying marketplace commission. Built from the July 2026 business plan & product
blueprint (MVP scope).

**What do you want to do?**

| | |
| --- | --- |
| Run it on my machine | [Run it locally](#run-it-locally) → [Demo logins](#demo-logins-password-for-all-password123) |
| Deploy it for the first time | [First deployment — do these in order](#first-deployment--do-these-in-order) |
| Ship an update | [Routine deploys](#routine-deploys-every-release-after-that) |
| Something's broken | [Troubleshooting](#troubleshooting) |
| Know which `.env` goes where | [Environment files](#environment-files) |
| See what's built vs not | [What's implemented](#whats-implemented-blueprint--code) · [Not yet built](#not-yet-built) |
| Import offers from takeaway websites | [Website import robot](#website-import-robot-truoffersbot) |

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Frontend | Next.js 16 (App Router, TypeScript, Tailwind 4)             |
| Backend  | NestJS 10 + Mongoose (JWT auth, role guards, class-validator) |
| Database | MongoDB (`truoffers` db, 2dsphere geo index for postcode search) |
| Queue    | Redis 7 + BullMQ (website import robot jobs; separate worker process) |

## Run it locally

MongoDB must be running on `localhost:27017` and Redis on `localhost:6379` (ServBay's MongoDB and
Redis work as-is). Docker is **not** needed for local development — it's only used for production.

```bash
# 1. Backend (port 4000)
cd backend
npm install
npm run seed              # wipes + seeds demo data (idempotent, dev only)
npm run migrate:scraper   # website import robot indexes + adapters (idempotent)
npm run start:dev         # API at http://localhost:4000/api
npm run start:worker      # in a second terminal: the website import robot's worker
# Optional, a third terminal: the render worker, for JavaScript-only sites and ordering-platform menus.
# Needs Chromium once (npx playwright-core install --only-shell chromium), then turn rendering on in Settings.
npm run build && SCRAPER_QUEUE_ROLE=render npm run start:worker:prod

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

## Website import robot (TruOffersBot)

Admins submit takeaway websites; the robot crawls **only authorised, permitted pages** and turns
what it finds into offer candidates with field-by-field evidence. **Nothing is published or
verified until an admin approves it or the business confirms it.** Data handling is documented in
[docs/data-protection.md](docs/data-protection.md).

```
admin UI ─▶ API (review, publish, opt-outs) ─▶ MongoDB ◀─ structured results only
               │ enqueue                                  │
               ▼                                          │
             Redis/BullMQ ◀──── worker: gate → safe fetch → extract → match → dedupe/score
```

**Using it** (sign in as admin@truoffers.co.uk):

1. **Submit websites** at `/admin/scraper/websites`: paste URLs, upload a CSV, or import a
   provider's client list (only for a provider with an *allowed* policy and a written agreement
   reference).
2. **Watch the run** at `/admin/scraper/jobs`. Each website goes through seven stages: analyse,
   discover, business, offers, match, dedupe and recheck (plus render, for JavaScript-only sites).
3. **Review** at `/admin/scraper/candidates`.
   - Compare the extracted offer with the source excerpts and the confidence breakdown.
   - Then edit, approve (unverified or admin-verified), reject, merge, or send it to the business
     to confirm.
   - Branches that couldn't be matched automatically wait in the **Business matches** tab.
4. **Businesses** see offers found on their website in their dashboard. Confirming or editing an
   imported offer makes it theirs: from then on the robot never changes it.
5. **Removal requests** (`/removal-request`) opt the domain out and unpublish its imported offers
   immediately. Acknowledge them at `/admin/scraper/policies`.

**Many websites on one template.** Takeaway sites are often built by the same web studio or
ordering provider. Instead of relying on generic extraction for each, build one selector adapter
for the template:

1. **Register a network** (optional) at `/admin/scraper/network`. Enter a studio or provider's
   client sitemap and the basis for using it: a written agreement reference, or notes from a terms
   review. *Discover* registers the websites that sitemap lists as authorised, up to 1,000 per run.
   - Opted-out websites and never-crawl domains are skipped.
   - A listed website that was only waiting for authorisation is authorised.
   - Websites held for provider review stay held.
   - Websites the robot only found as links stay pending.
2. **Build an adapter** at `/admin/scraper/adapters/new`.
   1. Pick two or more authorised websites that share the template.
   2. The worker reads a few pages from each and suggests a **template fingerprint**. The
      fingerprint is built from traits the sites share (generator tag, footer attribution, asset
      paths, CSS classes, page skeleton) and never from business content.
   3. Review which traits are required, and the CSS selectors suggested for offers and business
      details.
   4. Test on the examples. This is a dry run: it shows what each field would contain and never
      creates candidates.
   5. Approve.
   6. Match the fingerprint across authorised websites and run extraction on the exact and
      high-confidence matches.
3. **Manage adapters** at `/admin/scraper/adapters`. Versions are immutable once tested.
   - *New version* copies a version as a draft to edit and test.
   - *Roll back* withdraws the current version and makes the previous approved one current. Its
     open candidates are marked `needs_reextraction`, and *Re-run* re-extracts the affected websites.
   - *Pause* stops an adapter without withdrawing it.
   - Templates and their match scores are at `/admin/scraper/fingerprints`.

A selector adapter only runs on a website whose fingerprint match is at least **high confidence**;
a version under test only runs on its example websites. Matching needs evidence from at least
three kinds of trait, so a shared CDN or a common CSS framework alone never matches. Adapters use
CSS selectors and named parsers only (text, money, percent, date, promo code, phone, postcode, URL);
there's no way to enter a regular expression. When several adapters could handle a page, the order
is provider adapter, selector adapter, JSON-LD, then generic HTML.

**Ordering platforms (Foodhub, Grub24).** Many takeaway websites are hosted by ordering platforms,
and the robot recognises these two from the assets their pages use. It reads the offers from the
data the page already carries for its own JavaScript, and never calls the platform's API.

- **Foodhub:** the store's discounts, from the page data, or from the store data its app loads when
  the page is rendered. Also the deals in the menu's offer categories (*Meal Deals*, *Collection
  Offers*, *Double Saver*…), with the order types and days the menu states. Foodhub's app only loads
  the menu in the browser, so the deals need rendering turned on and a render worker running.
- **Grub24:** the offers list, plus the deals in the menu's offer categories.
- **Foodhub offers need one check before approving:** Foodhub's data doesn't say whether an offer is
  for collection or delivery, so those offers are flagged for you to set before approving.
- **If a platform's robots.txt blocks every bot** (as happened to one Foodhub site), the robot leaves
  it alone. When the *owner* tells you in writing that they want their offers listed anyway, a super
  admin can record that on the website's page (**Read despite robots.txt**, with who agreed, how and
  when). It applies to that one website, is audited, and an opt-out ends it; the rate limit and every
  other check still apply.
- **Platform policies:** each platform (or other provider) the robot finds is listed under
  **Policies & opt-outs** as *unknown*, and its websites are crawled.
  - *Block* a platform there to stop crawling all of its websites.
  - To hold every platform's websites until you allow that platform (with an agreement reference or
    terms-review notes), turn on **Review ordering platforms before crawling** in Settings.
    Turning it off again releases the websites waiting for a platform that isn't blocked.

**Keeping imports current.** Every completed run ends with a *recheck* step that applies what it
found to the offers already published from that website:

- **Found again:** the offer's *last checked* date is refreshed.
- **Not on a page the robot read** (or the page now returns 404): the offer is hidden at once and
  shows as *checking availability*. If the next check finds it, it is published again
  automatically. If it is missing twice in a row, it waits for an admin under **Imported offers →
  Expiry review**.
- **Different terms:** the published offer stays live and the change waits under **Imported
  offers → Changed terms**. There you see a before/after diff and choose to apply it (unverified or
  verified) or keep the published version. A discarded change isn't proposed again, and every
  decision stays in the offer's revision history.
- **The business manages the offer:** the robot never changes it. The business only sees that its
  website now says something different, and can update the offer or keep it.
- A check that couldn't read a page counts for nothing, so a slow website never hides offers.

Websites are checked on a schedule (`recheck_offer` runs through the worker):

| Website state | Next check |
|---|---|
| Has published offers | Every 24 hours |
| An offer ends within 48 hours | Every 6 hours |
| Nothing published | Weekly |
| Last check failed | After 1h, 4h, 16h, 64h, then weekly |
| Opted out, or held for provider review | Never |

A website's page or an adapter's page can set a different interval. Offers past their end date
are expired by `review_stale_offer`.

**JavaScript-only websites.** Some takeaway sites put their offers on the page with JavaScript, so
the static HTML has none. With **Render JavaScript-only websites** enabled in scraper settings, such
a run renders up to 3 pages in Chromium and reads the result with the same adapter. A site on an
ordering platform whose menu only loads in the browser (Foodhub) gets one render of its homepage even
when the page already had some offers. Rendering happens in a separate **render worker**
(`Dockerfile.render`), because the browser needs about 1 GB of memory:

- Every connection the browser makes, including each redirect hop, goes through a validating proxy
  with the same SSRF and never-crawl checks as normal fetching.
- The website's own URLs also go through robots.txt, blocked paths and the rate limit.
- Images, media, fonts and analytics hosts are never loaded.
- A bot challenge, CAPTCHA or login page stops the render, and the website is left alone for a week.
- A page is read once nothing has loaded for 3 seconds, or after 20 seconds at most, so an app that
  fetches its data late is still seen.
- The adapters also get the JSON the page's own scripts loaded from the website (an app's store or
  menu, say). Only requests the page made itself and that passed the checks above count; nothing
  extra is requested, and that data is read in memory and never stored.
- The browser restarts above 512 MB. Cancelling a run or pressing the emergency stop closes its
  pages at once.

Without a render worker running, rendering is simply never queued.

**Claim invitations.** **Claim invitations** (`/admin/scraper/outreach`) lists takeaways whose
imported offers are live but whose listing nobody has claimed. *Generate invitation* gives you a
claim link (valid for 30 days), a QR code, an email, a WhatsApp message and a phone script, all
using the approved wording.

- **Nothing is sent by TruOffers**; you copy the message and send it yourself, after checking PECR.
- The link opens the claim page with the business already selected. The owner still verifies as
  usual.
- *Record contact* notes how you reached them.
- A new invitation replaces the old link, and an approved claim marks the invitation used.

**Safety controls, all enforced in code:**

- **Pages it will fetch:**
  - A fixed never-crawl list covering marketplaces, search engines, maps and social networks.
  - Authorised domains only; domains the robot merely finds linked wait for an admin.
  - robots.txt, `X-Robots-Tag` and meta robots are respected.
- **How it fetches:**
  - One request every 2s per domain and 50 pages per website by default.
  - SSRF protection with DNS pinning, and at most 5 redirects.
  - Responses capped at 2 MB and a 20:1 compression ratio.
  - One fixed User-Agent (`TruOffersBot/1.0 (+<SITE_URL>/bot)`); logins, CAPTCHAs and rate limits
    are never bypassed.
- **What happens to results:**
  - Provider-hosted sites are held until that provider has an allowed policy.
  - AI extraction stays off until enabled in `/admin/scraper/settings` *and* `ANTHROPIC_API_KEY` is
    set.

**Stopping it:**

- **Emergency stop** (`/admin/scraper/jobs`) pauses every queue and aborts in-flight requests.
  Nothing resumes until an admin presses Resume.
- **Pausing a domain or an adapter** parks its jobs instead of failing them.
- Every admin action is written to the audit log (`/admin/scraper/audit`).

**Tests and the end-to-end check.** None of these contact a real website; they use fictional
`*.test` fixture sites.

```bash
cd backend && npm test                  # unit + integration + in-process end-to-end (needs Mongo + Redis)
scripts/e2e-phase1.sh                   # full Docker stack on an isolated network, driven over HTTP
scripts/e2e-phase2.sh                   # the same stack: network discovery, adapter builder, rollback
scripts/e2e-phase3.sh                   # the same stack plus a render worker: rechecks, revisions, rendering, invitations
```

The rendering tests need Chromium. The render worker image installs it; for local tests, run
`npx playwright-core install --only-shell chromium` in `backend/` once.

After upgrading, run `npm run migrate:scraper` (or `migrate:scraper:prod` in the container) once.
It is idempotent: it registers the built-in adapters and creates the indexes for every phase.
Unless provider review is on, it also releases websites held for a provider that isn't blocked.

## Not yet built

Honest gaps against the blueprint, so nobody plans around something that isn't there:

- **Mobile apps (§13)** — no native iOS/Android. The site is fully responsive; the blueprint puts
  apps in V2 anyway.
- **Two verification methods (§8)** — `email_domain` and `google_profile_match` exist as enum
  values but perform no automated check: picking them just files a claim for manual admin review.
  Working today: phone OTP, document upload, manual review, Foodbell auto-verify.
- **Admin tooling (§14.1)** — duplicate-listing detection/merge, complaint handling, blog/category
  CMS, and the email/SMS/push campaign manager are not built. Claim + offer moderation queues,
  plans, users and the dashboards *are*.
- **`support_tickets` (§11)** — this collection doesn't exist; support runs over email for now.
  An audit log exists for the website import robot's admin actions (`adminauditlogs`), but not
  yet for the rest of the admin area.
- **Foodbell deep integration (§27)** — only the hooks exist (`isFoodbellClient`, the verified
  badge, tracked order links). Menu import and dashboard publishing need a real Foodbell API.

## Social login (Google & Apple)

The login/register pages include "Continue with Google/Apple". The frontend only sends the
provider's **ID token**; the backend verifies it server-side (Google tokeninfo / Apple JWKS via
`jose`) and issues a TruOffers JWT, auto-creating the account on first sign-in.

To activate, create a Google OAuth client ID and/or an Apple Services ID, then set them in **both**
halves — the backend verifies tokens, the frontend renders the buttons:

- **Local dev**: `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` in `backend/.env`, plus
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_APPLE_CLIENT_ID` in `frontend/.env.local`.
- **Production**: `GOOGLE_CLIENT_ID` / `APPLE_CLIENT_ID` in the VPS `.env` (backend), **and** the
  same values in `.env.build` on the build machine (frontend) — they're compiled into the bundle,
  so changing them needs a rebuild, not just a restart.

Until configured, the buttons show a "not configured" notice rather than failing silently.
`GET /api/auth/providers` reports what's enabled.

## Hardening & best practices in place

- **Security**: helmet headers, rate limiting (100 req/min per IP, 10/min on auth endpoints,
  analytics exempt), JWT-secret guard that refuses to boot production with the dev secret,
  server-side plan-limit enforcement, OAuth tokens verified server-side only.
- **Background jobs** (§22): cron expires ended offers every 10 min, reconciles
  `activeOfferCount` hourly, charges promotion daily rates hourly (deduped to once per 24h),
  and syncs Google reviews nightly (batched to respect Places API quotas).
- **Ops**: `GET /api/health` (DB state, Redis and scraper worker status, uptime — only the DB affects
  `status`), graceful shutdown hooks, `.env.example` files.
- **SEO** (§17.2): `sitemap.xml` (static + town + business pages), `robots.txt` (dashboards
  disallowed), OpenGraph metadata with title template, schema.org Restaurant/Offer JSON-LD on
  business profiles.
- **UX resilience**: branded 404 and error pages, global loading state, stale-token auto-logout
  on 401.

## Environment files

Four files, each on exactly one machine. Every `.example` is committed; every real one is
gitignored.

| File | Lives on | Used by | Holds |
| ---- | -------- | ------- | ----- |
| `backend/.env` | your Mac | local dev API | Mongo URI, dev JWT secret, optional API keys |
| `frontend/.env.local` | your Mac | local dev web | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL` |
| `.env.build` | build machine (Mac/CI) | `build-and-push.sh` | `SITE_URL`, `PLATFORM`, `REGISTRY`, public client IDs — **no secrets** |
| `.env` (repo root) | **VPS only** | `docker compose` / `deploy.sh` | `SITE_DOMAIN`, `SITE_URL`, `JWT_SECRET`, Stripe/API keys |

Every optional key (Stripe, OAuth, Google Places, Anthropic) degrades gracefully when blank — the
feature switches to mock/template mode rather than crashing.

The split is deliberate: production secrets exist **only** on the VPS, never on your laptop or in CI.

---

# Deploying to the Ubuntu VPS

The whole stack runs as six containers:

- **caddy**: TLS and reverse proxy. It serves the site and proxies `/api/*` to the backend on the
  same origin, so there are no CORS preflights in production.
- **web**: Next.js.
- **api**: NestJS.
- **mongo**: the database.
- **redis**: the website import robot's job queue.
- **worker**: the robot's crawler. It uses the api image with a different entrypoint.

**The VPS never compiles anything.** Images are built on a machine with real RAM (your Mac or
GitHub Actions) and published to GHCR; the VPS only pulls and runs them. A 1GB VPS cannot run
`tsc`/`next build` — it thrashes swap for 20+ minutes or gets OOM-killed — but it runs the
prebuilt containers comfortably in ~400-600MB.

```
  BUILD MACHINE (Mac / GitHub Actions)          VPS (1GB is fine)
  ./build-and-push.sh  ──push──▶  GHCR  ──pull──▶  ./deploy.sh
```

```
                   :443  ┌─────────┐
  browser ──────────────▶│  caddy  │  auto TLS (Let's Encrypt)
                         └────┬────┘
                  /api/*  ┌───┴───┐  everything else
                     ┌────▶  api  │◀──── web (server-side render,
                     │    └───┬───┘       via internal network)
                     │        │
                     │    ┌───▼───┐
                     └────│ mongo │  no published ports — internal only
                          └───────┘
```

## First deployment — do these in order

Steps 1-4 happen **on the VPS**, step 5 **on your Mac**, step 6 back on the VPS. Do not skip
ahead: step 5 needs the architecture from step 1, and Caddy needs DNS from step 2.

### 1. Prepare the VPS

```bash
ssh user@vps

uname -m          # NOTE THIS DOWN. x86_64 -> linux/amd64 | aarch64 -> linux/arm64

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && newgrp docker

# Add swap — 1GB RAM leaves little headroom even just running containers.
# Keep it to 2G: the swapfile lives on the same disk, and these VPS images are
# often only ~10GB. Nothing compiles here, so 2G is plenty.
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

df -h /   # need ~4GB free AFTER the swapfile: images ~1.5GB + Mongo data + room to grow

# Firewall: only SSH + web. Mongo is never published.
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable
```

### 2. Point DNS at the VPS

Do this **before** deploying — Caddy cannot issue a TLS certificate for a domain that doesn't
resolve to the box yet. Wait until `dig +short truoffers.co.uk` returns your VPS IP.

```
A    truoffers.co.uk       ->  <VPS_IP>
A    www.truoffers.co.uk   ->  <VPS_IP>
```

No domain yet? Skip this and set `SITE_DOMAIN=:80` / `SITE_URL=http://<VPS_IP>` in step 4 to run
plain HTTP. Switch to the real domain and redeploy later.

### 3. Let the VPS pull from the registry

GHCR packages are **private by default**, so the VPS needs credentials. Create a GitHub token
([Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)) with
the **`read:packages`** scope, then:

```bash
echo <GITHUB_PAT> | docker login ghcr.io -u rezapr2 --password-stdin
```

Or make the packages public once they exist (GitHub → your profile → Packages →
`truoffers-api` / `truoffers-web` → Package settings → Change visibility), and no login is needed.

### 4. Clone and configure the VPS

```bash
sudo mkdir -p /srv && sudo chown "$USER" /srv
git clone https://github.com/rezapr2/truoffers.git /srv/truoffers
cd /srv/truoffers

cp .env.production.example .env
openssl rand -hex 32          # copy the output into JWT_SECRET
nano .env                     # set SITE_DOMAIN, SITE_URL, JWT_SECRET
```

`JWT_SECRET` is mandatory — the API deliberately refuses to boot in production without a real one.

### 5. Build and publish the images (on your Mac)

```bash
cd ~/Desktop/truoffers
cp .env.build.example .env.build
nano .env.build      # SITE_URL=https://truoffers.co.uk
                     # PLATFORM=  <- the value from step 1 (linux/amd64 for x86_64)

echo <GITHUB_PAT> | docker login ghcr.io -u rezapr2 --password-stdin   # scope: write:packages
./build-and-push.sh
```

> **Architecture matters.** Your Mac is arm64; your VPS is almost certainly x86_64. An arm64 image
> pushes and pulls fine, then fails to start on the VPS with a confusing "exec format error".
> `build-and-push.sh` cross-builds `linux/amd64` by default to prevent this — only change
> `PLATFORM` if step 1 said `aarch64`.

**Prefer not to use your Mac?** Push to `main` and `.github/workflows/build-images.yml` builds both
images on GitHub's native amd64 runners for free. Set the repo variable `SITE_URL` first
(Settings → Secrets and variables → Actions → Variables). Deploys stay manual — no SSH keys in CI.

### 6. Deploy and seed (on the VPS)

```bash
cd /srv/truoffers
./deploy.sh --no-git-pull            # nothing to git pull on a fresh clone

docker compose exec api npm run seed:prod                # ONCE, first setup only
docker compose exec api npm run migrate:scraper:prod     # website import robot indexes (idempotent)
```

> **Upgrading an existing database?** Run only the migration, never the seed. If two listings share
> a postcode and name, the migration lists them and stops. Merge or rename them, or rerun with
> `-- --skip-duplicates` to leave the newer listing unindexed until you do.

> **Careful:** `seed:prod` wipes and recreates the seeded collections. Never run it against a
> database holding real customer data.

Visit `https://truoffers.co.uk` — you should get the homepage with seeded offers, and
`https://truoffers.co.uk/api/health` should return `{"status":"ok","db":"connected"}`.

---

## Routine deploys (every release after that)

```bash
# 1. On your Mac — or just push to main and let GitHub Actions build it
./build-and-push.sh

# 2. On the VPS
ssh user@vps && cd /srv/truoffers
./deploy.sh          # git pull → pull images → restart → health-check → prune
```

Takes ~30 seconds — it's a download, not a compile. `deploy.sh` fails loudly and prints the API
logs if the health check doesn't pass, so a broken release is never reported as a success.

**Rolling back** — every build is also tagged with its commit sha:

```bash
IMAGE_TAG=sha-a1b2c3d ./deploy.sh
```

### Backups

`backup.sh` writes a gzipped `mongodump` archive and keeps the newest 14. Schedule it nightly:

```bash
crontab -e
# 0 3 * * * /srv/truoffers/backup.sh >> /var/log/truoffers-backup.log 2>&1
```

Restore with:

```bash
docker compose exec -T mongo mongorestore --archive --gzip --drop < /var/backups/truoffers/<file>
```

### Operating it

| Task              | Command                                              |
| ----------------- | ---------------------------------------------------- |
| Status            | `docker compose ps`                                  |
| Logs (follow)     | `docker compose logs -f api` (or `web`, `caddy`)     |
| Restart one app   | `docker compose restart api`                         |
| Mongo shell       | `docker compose exec mongo mongosh truoffers`        |
| Stop everything   | `docker compose down` (data survives in volumes)     |
| Health            | `curl https://truoffers.co.uk/api/health`            |
| Robot worker logs | `docker compose logs -f worker` (JSON lines: runId, jobId, domain) |
| Stop the robot    | Emergency stop in `/admin/scraper/jobs`, or `docker compose stop worker` |
| Start rendering   | Needs a VPS with at least 2 GB: add `COMPOSE_PROFILES=render` to `.env`, then `./deploy.sh` |

### Troubleshooting

| Symptom | Cause & fix |
| ------- | ----------- |
| `deploy.sh`: "could not pull the images" | Images not published yet (run `./build-and-push.sh`), or the VPS isn't logged in to GHCR (step 3). The script prints the full checklist. |
| Container exits with **"exec format error"** | Architecture mismatch — an arm64 image on an x86_64 VPS. Set `PLATFORM=linux/amd64` in `.env.build` and rebuild. |
| API restarts in a loop | Usually a missing/blank `JWT_SECRET` in the VPS `.env` — the app refuses to boot in production without one. Check `docker compose logs api`. |
| **"dependency mongo failed to start … is unhealthy"** | **Check `df -h /` first.** A full disk is the #1 cause and does not look like one: Mongo can't write its journal, so it shuts down uncleanly and never recovers, and the FTDC thread throws a scary stack trace. See the disk-full row below.<br><br>If there IS free space, Mongo is simply replaying its journal (`docker compose logs mongo` shows `Detected unclean shutdown` + `WT_VERB_RECOVERY_PROGRESS`), which takes minutes on a small VPS. Retrying `deploy.sh` makes it *worse* — each attempt recreates the container mid-recovery. Let it recover alone: `docker compose up -d mongo`, then `docker compose logs -f mongo` until `"Waiting for connections"`, then `./deploy.sh`. |
| **Disk 100% full** (`df -h /` shows `0` available) | Usually Docker build cache and old images, plus an oversized swapfile. Reclaim:<br>`docker builder prune -a -f`<br>`docker compose down && docker system prune -a -f` (**never** `--volumes` — that deletes your database)<br>`sudo du -sh /var/lib/docker /swapfile /var/log \| sort -h`<br>If Mongo won't recover afterwards its files were damaged by the full disk; if the data is expendable: `docker compose down -v && ./deploy.sh && docker compose exec api npm run seed:prod`. `deploy.sh` now refuses to run below 1.5GB free. |
| Site loads but every API call fails | `SITE_URL` in `.env.build` didn't match the live domain, so the wrong URL was baked into the bundle. Rebuild and repush. |
| No TLS certificate | DNS isn't pointing at the VPS yet, or ports 80/443 are firewalled. Check `dig +short <domain>` and `docker compose logs caddy`. |
| Frontend changes don't appear | You restarted instead of rebuilding. `NEXT_PUBLIC_*` is compile-time — rerun `./build-and-push.sh`. |

### Notes & gotchas

- **`NEXT_PUBLIC_*` are baked in at build time**, not runtime — they come from `SITE_URL` /
  `GOOGLE_CLIENT_ID` in **`.env.build` on the build machine**, not from the VPS's `.env`.
  Changing the domain or a client ID means `./build-and-push.sh` again, then `./deploy.sh` —
  a restart alone will not pick it up.
- **Two env files, two machines**: `.env.build` (build machine — public values only, no secrets)
  and `.env` (VPS — real secrets, never committed). Production secrets never touch your laptop.
- **Mongo publishes no ports**, by design. There's nothing to tunnel to from your laptop — use
  `docker compose exec mongo mongosh truoffers` on the box instead.
- **Sizing**: the prebuilt containers run in roughly 400-600MB, plus Redis (capped at 96MB) and the
  robot worker (capped at 256MB), so 1GB + 2GB swap is workable but tight.
  Nothing compiles on the VPS — that's the whole point of the registry flow. Don't be tempted to
  add a `build:` section back into `docker-compose.yml`; a 1GB box cannot run `tsc`/`next build`.
- **Cron jobs run in-process** (`@nestjs/schedule`) inside the always-on `api` container — offer
  expiry, promotion charges and review sync need no external scheduler. This is why the app wants
  a real server rather than serverless.
