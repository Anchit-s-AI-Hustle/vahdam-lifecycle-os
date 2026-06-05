/**
 * /api/competitor — consolidated competitor-intelligence backend.
 *
 * One Vercel serverless function serving every competitor operation, routed by
 * the `op` query param. Consolidated into a single function so the whole hub
 * backend fits inside the project's Hobby 12-function budget while living
 * entirely in this repo (no separate deployment, no cross-origin reads):
 *
 *   GET  /api/competitor?op=emails              → list all rows
 *   GET  /api/competitor?op=email&id=<row>      → { html } for one email
 *   GET|POST /api/competitor?op=poll            → throttled sync trigger (returns stats)
 *   POST /api/competitor?op=sync                → run sync (CRON_SECRET protected)
 *   POST /api/competitor?op=gmail-push          → Pub/Sub push webhook (real-time)
 *   POST /api/competitor?op=watch               → (re)arm Gmail watch (CRON_SECRET protected)
 *   GET  /api/competitor?op=health              → liveness
 *
 * All secrets stay server-side. The data layer lives in api/_shared/competitor/*.
 */
import { getAllEmails, getEmailHtml } from "../_shared/competitor/google-client";
import { runSync } from "../_shared/competitor/sync";
import {
  decodePubSubMessage,
  registerWatch,
  verifyPubSubJwt,
} from "../_shared/competitor/gmail-oauth";

export const config = { maxDuration: 60 };

const CORS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Throttle real syncs (per warm instance) so frequent dashboard polls collapse
// into at most one sync per window.
const POLL_THROTTLE_MS = 30_000;
let lastSync = 0;

function setCors(res: any) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

function isAuthorized(req: any): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unprotected only if no secret configured (dev)
  const auth = req.headers["authorization"] || "";
  if (auth === `Bearer ${secret}`) return true;
  return (req.query?.secret || "") === secret;
}

export default async function handler(req: any, res: any) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const op = String(req.query?.op || "emails");

  try {
    // ── Reads ──────────────────────────────────────────────────────────
    if (op === "emails") {
      const emails = await getAllEmails();
      return res.status(200).json({ ok: true, emails });
    }

    if (op === "email") {
      const id = parseInt(String(req.query?.id || ""), 10);
      const html = Number.isInteger(id) ? await getEmailHtml(id) : "";
      return res.status(200).json({ ok: true, html });
    }

    if (op === "health") {
      return res.status(200).json({ ok: true, service: "competitor" });
    }

    // ── Sync trigger (public, throttled) ───────────────────────────────
    if (op === "poll") {
      const now = Date.now();
      const sinceLast = now - lastSync;
      if (sinceLast < POLL_THROTTLE_MS) {
        return res.status(200).json({
          ok: true,
          throttled: true,
          nextSyncInMs: POLL_THROTTLE_MS - sinceLast,
        });
      }
      lastSync = now;
      try {
        const result = await runSync();
        return res.status(200).json({ ok: true, throttled: false, ...result });
      } catch (err: any) {
        lastSync = 0; // let the next attempt retry immediately
        return res.status(500).json({ ok: false, error: err?.message || "sync failed" });
      }
    }

    // ── Protected sync (cron / manual) ─────────────────────────────────
    if (op === "sync") {
      if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
      const result = await runSync();
      return res.status(200).json(result);
    }

    // ── Gmail Pub/Sub push webhook (real-time wake-up) ─────────────────
    if (op === "gmail-push") {
      const auth = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
      try {
        await verifyPubSubJwt(auth);
      } catch (err: any) {
        console.warn("[competitor] push JWT verify failed:", err?.message);
        return res.status(200).json({ ok: false, reason: "auth" });
      }
      try {
        const decoded = decodePubSubMessage(req.body);
        console.log(`[competitor] push ${decoded.emailAddress || "?"} historyId=${decoded.historyId || "?"}`);
      } catch { /* logging only */ }
      // Fire-and-forget nudge — ack fast so Pub/Sub doesn't retry.
      void runSync().catch((err) => console.error("[competitor] push sync failed:", err?.message));
      return res.status(200).json({ ok: true });
    }

    // ── (Re)arm Gmail watch (7-day expiry; call from a daily cron) ──────
    if (op === "watch") {
      if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
      const result = await registerWatch();
      return res.status(200).json({ ok: true, ...result });
    }

    return res.status(400).json({ ok: false, error: `unknown op: ${op}` });
  } catch (err: any) {
    console.error(`[competitor] op=${op} failed:`, err);
    return res.status(500).json({ ok: false, error: err?.message || "error" });
  }
}
