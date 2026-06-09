# workers/ — local browser automation

Jobs that need a real browser (Playwright) and therefore **cannot** run inside the
Vercel 12-function Hobby budget. They run on your machine / CI, read from the
deployed API, and write back through token-protected endpoints — so they stay
**keyless** (no Google service-account key on the worker).

## auto-subscribe.js — subscribe the capture inbox to competitor newsletters

Subscribes `ojhapraneet@gmail.com` (the capture inbox) to each competitor brand's
newsletter so their lifecycle mail (welcome → promo → abandoned-cart → win-back)
lands in the inbox the IMAP sync already reads into the Brands Google Sheet.

**Identity safety:** the only identity used is `SUBSCRIBE_EMAIL`. The worker never
logs into Gmail or touches the signed-in app user — it just types that address into
third-party signup forms, like a human would.

### Setup (first time)
```bash
npm i
npx playwright install chromium
```

### Run
```bash
# subscribe every brand not yet "Subscribed" (status written back to the sheet)
INGEST_TOKEN=<your token> npm run subscribe

# common variations
BASE_URL=https://your-app.vercel.app MAX=10 npm run subscribe   # cap to 10
SUBSCRIBE_EMAIL=ojhapraneet@gmail.com HEADFUL=1 npm run subscribe # watch it run
DRY_RUN=1 npm run subscribe                                       # find+fill forms, don't submit / don't write back
JOURNEY=1 npm run subscribe                                       # also add a bestseller to cart → bait abandoned-cart emails
ONLY=teaforte.com,harney.com npm run subscribe                   # restrict to domains
FORCE=1 npm run subscribe                                         # re-run brands already Subscribed
```

### How it works
1. `GET /api/competitor?action=brands` → the brand universe (with `newsletterSignupUrl`,
   `websiteUrl`, `subscriptionStatus`).
2. For each not-yet-subscribed brand: open the signup URL in a fresh isolated
   browser context, dismiss cookie/consent banners, wait for delayed pop-ups,
   locate the newsletter **email** input (context-scored so footer signup beats a
   search box), fill `SUBSCRIBE_EMAIL`, submit, and check for a thank-you/confirm cue.
3. `POST /api/competitor?action=mark-subscribed` (header `x-ingest-token`) writes
   `Subscription Status` + `Date Subscribed` back to the Brands sheet, keyless.
4. A screenshot per brand is saved to `workers/.artifacts/<domain>.png` (gitignored).

### Env vars
| var | default | meaning |
|---|---|---|
| `BASE_URL` | the prod alias | deployed API to read/write |
| `SUBSCRIBE_EMAIL` | `ojhapraneet@gmail.com` | the capture inbox |
| `INGEST_TOKEN` | — | matches `INGEST_TOKEN` on Vercel; required for write-back |
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
  (would read the capture inbox for the confirmation mail and visit its link).
- **After a run:** captured mail arrives over minutes–hours. Trigger a pull with
  `GET /api/competitor?action=sync` (needs `CRON_SECRET`) or let the cron do it.
- **Be a good citizen:** keep `DELAY_MS` sane and don't hammer a brand repeatedly.
