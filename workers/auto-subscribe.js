#!/usr/bin/env node
'use strict';

/**
 * Auto-subscribe worker — subscribes the capture inbox to competitor newsletters
 * so their lifecycle mail (welcome, promo, abandoned-cart, win-back) flows into
 * the Competitor Benchmarking capture pipeline (IMAP → Google Sheet).
 *
 * WHY a LOCAL worker, not a Vercel function:
 *   Playwright drives a real (headless) browser, which can't run inside the
 *   12-function Hobby serverless budget. This script runs on your machine (or any
 *   Node box / CI runner), reads the brand list from the DEPLOYED API, drives the
 *   signup forms, and writes the outcome back through a token-protected endpoint —
 *   so the worker stays KEYLESS (no Google service-account key ever leaves Vercel).
 *
 * IDENTITY SAFETY:
 *   The ONLY identity this worker ever uses is SUBSCRIBE_EMAIL (the capture inbox,
 *   ojhapraneet@gmail.com). It never reads, opens, or authenticates the signed-in
 *   app user's mailbox. It does not log into Gmail at all — it only types that
 *   address into third-party newsletter forms, exactly like a human would.
 *
 * FIRST RUN:
 *   npm i                     # ensure @playwright/test is installed
 *   npx playwright install chromium
 *
 * USAGE:
 *   INGEST_TOKEN=… node workers/auto-subscribe.js                 # subscribe every brand not yet "Subscribed"
 *   BASE_URL=https://your-app.vercel.app MAX=10 node workers/auto-subscribe.js
 *   SUBSCRIBE_EMAIL=ojhapraneet@gmail.com HEADFUL=1 node workers/auto-subscribe.js
 *   DRY_RUN=1 node workers/auto-subscribe.js                      # locate forms, fill, but DON'T submit
 *   JOURNEY=1 node workers/auto-subscribe.js                      # also seed an abandoned-cart (add a bestseller to cart)
 *   ONLY=teaforte.com,harney.com node workers/auto-subscribe.js   # restrict to specific domains
 *   FORCE=1 node workers/auto-subscribe.js                        # include brands already marked Subscribed
 *
 * npm shortcut:  npm run subscribe   (then append env vars / flags as above)
 *
 * Each attempt writes a screenshot to workers/.artifacts/<domain>.png for audit.
 */

const fs = require('fs');
const path = require('path');
// @playwright/test re-exports the browser launchers; no separate `playwright` dep needed.
const { chromium, devices } = require('@playwright/test');

// ── Config (all via env, with safe defaults) ──────────────────────────────────
const BASE_URL = (process.env.BASE_URL ||
  'https://vahdam-lifecycle-os-anchittandon-3589s-projects.vercel.app').replace(/\/$/, '');
const SUBSCRIBE_EMAIL = process.env.SUBSCRIBE_EMAIL || 'ojhapraneet@gmail.com';
const INGEST_TOKEN = (process.env.INGEST_TOKEN || '').trim();
const MAX = Number(process.env.MAX) || 0;                 // 0 = no cap
const HEADFUL = !!process.env.HEADFUL;
const DRY_RUN = !!process.env.DRY_RUN;
const JOURNEY = !!process.env.JOURNEY;
const FORCE = !!process.env.FORCE;
const ONLY = new Set((process.env.ONLY || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT) || 30000;
const DELAY_MS = Number(process.env.DELAY_MS) || 4000;    // politeness gap between brands
const ARTIFACT_DIR = path.join(__dirname, '.artifacts');

const norm = (u) => String(u || '').toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Step 1: pull the brand universe from the live API ─────────────────────────
async function fetchBrands() {
  const r = await fetch(`${BASE_URL}/api/competitor?action=brands`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`brands fetch failed: HTTP ${r.status}`);
  const j = await r.json();
  if (!j.ok || !Array.isArray(j.brands)) throw new Error('brands payload malformed');
  return j.brands;
}

// ── Step 5: write the outcome back (keyless, token-protected) ─────────────────
async function reportStatus(brand, status, extra) {
  const payload = {
    domain: brand.domain || brand.websiteUrl,
    websiteUrl: brand.websiteUrl,
    status,
    dateSubscribed: new Date().toISOString(),
    confirmationRequired: 'Yes',          // most DTC lists are double opt-in
    confirmationCompleted: '',
    ...(extra || {}),
  };
  try {
    const r = await fetch(`${BASE_URL}/api/competitor?action=mark-subscribed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-token': INGEST_TOKEN },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) console.warn(`   ↳ status write-back failed (HTTP ${r.status}): ${j.error || ''}`);
    return j.ok;
  } catch (e) {
    console.warn(`   ↳ status write-back error: ${e.message}`);
    return false;
  }
}

// ── Cookie / consent banners block interaction — clear them first ─────────────
async function dismissConsent(page) {
  const labels = [/accept all/i, /accept/i, /agree/i, /got it/i, /allow all/i, /i agree/i, /continue/i, /ok/i];
  for (const re of labels) {
    try {
      const btn = page.getByRole('button', { name: re }).first();
      if (await btn.isVisible({ timeout: 800 }).catch(() => false)) { await btn.click({ timeout: 1500 }).catch(() => {}); return; }
    } catch (_) { /* keep trying */ }
  }
}

/**
 * Find the most plausible newsletter EMAIL input on the page and fill it.
 * Strategy, best-first:
 *   1. visible <input type=email>
 *   2. visible input whose name/id/placeholder/aria mentions "email"
 * Prefer inputs that sit inside a form/section whose text mentions
 * subscribe / newsletter / sign up, and prefer the LAST such match (footer
 * signup is the canonical one; header search bars rarely take an email).
 */
async function findEmailInput(page) {
  const candidates = page.locator(
    'input[type="email"], input[name*="email" i], input[id*="email" i], ' +
    'input[placeholder*="email" i], input[aria-label*="email" i]'
  );
  const n = await candidates.count();
  let best = null;
  for (let i = 0; i < n; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    if (!(await el.isEditable().catch(() => false))) continue;
    // Score by surrounding context — newsletter forms beat search/login fields.
    const ctx = await el.evaluate((node) => {
      const form = node.closest('form, section, footer, div[class*="newsletter" i], div[class*="subscribe" i]');
      return (form ? form.innerText : (node.placeholder || '')).slice(0, 400).toLowerCase();
    }).catch(() => '');
    const score = (/news ?letter|subscribe|sign ?up|join|email list|stay in|get .*off|first to know|updates/.test(ctx) ? 2 : 0)
      + (/search|login|log in|sign in|password/.test(ctx) ? -3 : 0);
    if (!best || score >= best.score) best = { el, score };
  }
  return best ? best.el : null;
}

async function submitForm(page, input) {
  // Try the submit button nearest the email input first; fall back to Enter.
  const btn = await input.evaluateHandle((node) => {
    const form = node.closest('form');
    const scope = form || node.parentElement || document;
    const buttons = Array.from(scope.querySelectorAll('button, input[type="submit"], [role="button"]'));
    const re = /subscribe|sign ?up|join|notify|submit|continue|→|›|get/i;
    return buttons.find((b) => re.test((b.innerText || b.value || b.getAttribute('aria-label') || ''))) || buttons[0] || null;
  }).catch(() => null);
  const elt = btn && btn.asElement && btn.asElement();
  if (elt) {
    await elt.click({ timeout: 3000 }).catch(async () => { await input.press('Enter').catch(() => {}); });
  } else {
    await input.press('Enter').catch(() => {});
  }
}

// Did the signup appear to take? Heuristic: a thank-you / confirmation cue, or
// the input got cleared/detached after submit.
async function looksSubscribed(page) {
  const ok = await page.locator('text=/thank you|thanks for|you.?re (now )?subscribed|check your (inbox|email)|almost there|confirm your|welcome|you.?re in|successfully/i')
    .first().isVisible({ timeout: 4000 }).catch(() => false);
  return ok;
}

// Optional: bait an abandoned-cart flow by adding a bestseller to the cart.
async function seedCartJourney(page, brand) {
  try {
    const dest = brand.bestsellerUrl || brand.newArrivalsUrl ||
      (brand.websiteUrl ? brand.websiteUrl.replace(/\/$/, '') + '/collections/all' : null);
    if (!dest) return false;
    await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => {});
    await dismissConsent(page);
    // If we're on a collection, click into the first product.
    const card = page.locator('a[href*="/products/"]').first();
    if (await card.isVisible({ timeout: 3000 }).catch(() => false)) {
      await card.click({ timeout: 4000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    const addBtn = page.getByRole('button', { name: /add to (cart|bag)|add to basket/i }).first();
    if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addBtn.click({ timeout: 4000 }).catch(() => {});
      await sleep(1500);
      return true;
    }
  } catch (_) { /* best-effort */ }
  return false;
}

async function processBrand(context, brand) {
  const domain = brand.domain || norm(brand.websiteUrl);
  const target = brand.newsletterSignupUrl || brand.websiteUrl;
  if (!target) return { domain, result: 'no-url' };

  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  let result = 'form-not-found';
  try {
    await page.goto(/^https?:\/\//.test(target) ? target : `https://${target}`,
      { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await dismissConsent(page);
    await sleep(2500);                 // let delayed signup pop-ups render
    await dismissConsent(page);        // a popup may have introduced its own consent

    let input = await findEmailInput(page);
    if (!input) {                      // many sites only show the form in the footer
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(1200);
      input = await findEmailInput(page);
    }

    if (input) {
      await input.scrollIntoViewIfNeeded().catch(() => {});
      await input.fill(SUBSCRIBE_EMAIL, { timeout: 4000 });
      if (DRY_RUN) {
        result = 'dry-run-filled';
      } else {
        await submitForm(page, input);
        await sleep(2500);
        result = (await looksSubscribed(page)) ? 'subscribed' : 'submitted';
      }
    }

    if (JOURNEY && !DRY_RUN) {
      const baited = await seedCartJourney(page, brand);
      if (baited) result += '+cart';
    }
  } catch (e) {
    result = `error:${(e.message || '').slice(0, 60)}`;
  } finally {
    try {
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `${domain || 'unknown'}.png`), fullPage: false }).catch(() => {});
    } catch (_) {}
    await page.close().catch(() => {});
  }
  return { domain, result };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
(async function main() {
  console.log(`▶ auto-subscribe worker`);
  console.log(`   API:    ${BASE_URL}`);
  console.log(`   email:  ${SUBSCRIBE_EMAIL}`);
  console.log(`   mode:   ${DRY_RUN ? 'DRY-RUN ' : ''}${JOURNEY ? 'JOURNEY ' : ''}${HEADFUL ? 'HEADFUL' : 'headless'}`);
  if (!INGEST_TOKEN) console.log('   ⚠ no INGEST_TOKEN set — status write-back will be rejected if the API requires one.');

  let brands;
  try { brands = await fetchBrands(); }
  catch (e) { console.error(`✗ could not load brands: ${e.message}`); process.exit(1); }

  let queue = brands.filter((b) => b.websiteUrl || b.newsletterSignupUrl);
  if (ONLY.size) queue = queue.filter((b) => ONLY.has((b.domain || norm(b.websiteUrl))));
  if (!FORCE) queue = queue.filter((b) => !/^subscribed/i.test(String(b.subscriptionStatus || '')));
  if (MAX > 0) queue = queue.slice(0, MAX);

  console.log(`   queue:  ${queue.length} brand(s)${MAX ? ` (capped at ${MAX})` : ''} of ${brands.length} total\n`);
  if (!queue.length) { console.log('Nothing to do.'); return; }

  const browser = await chromium.launch({ headless: !HEADFUL });
  const summary = [];
  try {
    for (let i = 0; i < queue.length; i++) {
      const brand = queue[i];
      const label = brand.brandName || brand.domain || brand.websiteUrl;
      process.stdout.write(`[${i + 1}/${queue.length}] ${label} … `);

      // Fresh, isolated context per brand — clean cookies, realistic fingerprint.
      const context = await browser.newContext({
        ...devices['Desktop Chrome'],
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
      });
      const { domain, result } = await processBrand(context, brand);
      await context.close().catch(() => {});

      console.log(result);
      summary.push({ brand: label, domain, result });

      // Persist status for real attempts (skip pure dry-runs / no-url / errors-before-form).
      if (!DRY_RUN && /^(subscribed|submitted)/.test(result)) {
        const confDone = /\bsubscribed\b/.test(result) ? '' : '';
        await reportStatus(brand, result.startsWith('subscribed') ? 'Subscribed' : 'Submitted (unconfirmed)', { confirmationCompleted: confDone });
      } else if (DRY_RUN && result === 'dry-run-filled') {
        // no write-back in dry-run
      }

      if (i < queue.length - 1) await sleep(DELAY_MS);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // ── Report ──
  const tally = summary.reduce((m, s) => { const k = s.result.split(':')[0].split('+')[0]; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log('\n── summary ──');
  for (const s of summary) console.log(`  ${s.result.padEnd(22)} ${s.brand}`);
  console.log('\n', tally);
  console.log(`\nScreenshots: ${ARTIFACT_DIR}`);
  console.log('Captured mail will arrive over the next minutes–hours; run the IMAP sync (?action=sync) or wait for the cron to pull it into the sheet.');
})();
