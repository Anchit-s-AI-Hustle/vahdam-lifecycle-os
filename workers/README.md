# workers/ — local browser automation

Jobs that need a real browser (Playwright) and therefore **cannot** run inside the
Vercel 12-function Hobby budget. They run on your machine / CI.

## auto-subscribe.js — subscribe the capture inbox to competitor newsletters

Subscribes `ojhapraneet@gmail.com` (the capture inbox) to each competitor brand's
newsletter so their lifecycle mail (welcome → promo → abandoned-cart → win-back)
lands in the inbox the IMAP sync already reads into the Brands Google Sheet.

### Data path — talks to the Google Sheet **directly**
The deployed API is behind Vercel SSO (Deployment Protection), so a headless
worker can't reach it. Instead the worker reuses the **same tested sheet logic the
server uses** (`api/_shared/competitor-core.js`): `getBrands()` to read brands and
`markBrandSubscribed()` to write status back, authenticating with a Google
service-account key from `.env.local`. (Locally, keyless WIF can't engage — no
Vercel OIDC token — so it correctly falls back to legacy JWT.)

**Identity safety:** the only identity used to *subscribe* is `SUBSCRIBE_EMAIL`. The
worker never logs into Gmail or touches the signed-in app user — it just types that
address into third-party signup forms. The SA key is used ONLY to read/write the
Brands sheet.

### Setup (first time)
```bash
npm i
npx playwright install chromium
```
Then create `.env.local` at the **repo root** (gitignored) with the SA that is
already shared on the competitor sheet:
```ini
GOOGLE_SHEET_ID=<the competitor sheet id>
GOOGLE_SERVICE_ACCOUNT_EMAIL=<…@….iam.gserviceaccount.com>
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
GOOGLE_BRANDS_TAB=Competitors          # optional (defaults to Competitors)
```
`\n`-escaped or real newlines both work. If you have the SA key as a JSON file,
the email is the `client_email` field and the key is the `private_key` field.

### Run
```bash
npm run subscribe                # subscribe every brand not yet "Subscribed"
MAX=10 npm run subscribe         # cap to 10
HEADFUL=1 npm run subscribe      # watch the browser
DRY_RUN=1 npm run subscribe      # find + fill forms, DON'T submit / DON'T write back
JOURNEY=1 npm run subscribe      # also add a bestseller to cart → bait abandoned-cart emails
ONLY=teaforte.com,harney.com npm run subscribe
FORCE=1 npm run subscribe        # re-run brands already Subscribed
```
Recommended first real run: `DRY_RUN=1 MAX=5 HEADFUL=1 npm run subscribe` to eyeball
form detection, then drop `DRY_RUN`.

### How it works
1. `core.getBrands()` → the brand universe from the sheet (with `newsletterSignupUrl`,
   `websiteUrl`, `subscriptionStatus`).
2. For each not-yet-subscribed brand: open the signup URL in a fresh isolated browser
   context, dismiss cookie/consent banners, wait for delayed pop-ups, locate the
   newsletter **email** input (context-scored so footer signup beats a search box),
   fill `SUBSCRIBE_EMAIL`, submit, check for a thank-you/confirm cue.
3. `core.markBrandSubscribed()` writes `Subscription Status` + `Date Subscribed` back
   to the Brands sheet.
4. A screenshot per brand → `workers/.artifacts/<domain>.png` (gitignored).

### Env vars
| var | default | meaning |
|---|---|---|
| `GOOGLE_SHEET_ID` | — | competitor sheet id (required) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | — | SA email, shared on the sheet (required) |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | — | SA private key (required) |
| `GOOGLE_BRANDS_TAB` | `Competitors` | brands tab name |
| `SUBSCRIBE_EMAIL` | `ojhapraneet@gmail.com` | the capture inbox |
| `MAX` | `0` (all) | cap number of brands |
| `HEADFUL` | off | show the browser |
| `DRY_RUN` | off | fill but don't submit; no write-back |
| `JOURNEY` | off | also seed an abandoned cart |
| `FORCE` | off | include brands already Subscribed |
| `ONLY` | — | comma-separated domains to restrict to |
| `DELAY_MS` | `4000` | politeness gap between brands |
| `NAV_TIMEOUT` | `30000` | per-navigation timeout (ms) |

### Notes
- **Double opt-in:** many lists send a confirmation email. The worker marks
  `Confirmation Required = Yes`; clicking the confirm link is a future enhancement
  (read the capture inbox for the confirmation mail, visit its link).
- **After a run:** captured mail arrives over minutes–hours. Trigger a pull with
  `GET /api/competitor?action=sync` (needs `CRON_SECRET`) or let the cron do it.
- **There is also** a server endpoint `POST /api/competitor?action=mark-subscribed`
  (token-auth via `INGEST_TOKEN`) for the same write-back — unused by this worker
  while the API is SSO-gated, but available if a public path or bypass is added later.
- **Be a good citizen:** keep `DELAY_MS` sane; don't hammer a brand repeatedly.
