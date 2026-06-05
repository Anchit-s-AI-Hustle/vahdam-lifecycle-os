/**
 * GET /api/emails — read-only endpoint the dashboard uses for live refresh.
 * Returns all rows from the Google Sheet as CompetitorEmail[].
 *
 * NEAR-REAL-TIME: because Vercel Hobby caps platform cron at once/day, this read
 * endpoint ALSO opportunistically kicks a background mail sync (throttled to at
 * most once per minute) via `after()`, so simply having the dashboard open keeps
 * new mail flowing in — no external cron service required. The sync runs AFTER
 * the response is sent, so reads stay fast, and the CRON_SECRET never leaves the
 * server. An external 1-min cron can still be layered on for when nobody's looking.
 */
// @ts-ignore
import { NextRequest, NextResponse, unstable_after as after } from "next/server";
import { getAllEmails } from "@/lib/google-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only and public-ish — allow the Lifecycle OS dashboard (and others) to
// fetch this cross-origin.
const CORS = {
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// Throttle opportunistic syncs (per warm instance). 60s keeps cadence near the
// dashboard's 45s poll without hammering Gmail/Drive on every read.
const SYNC_THROTTLE_MS = 60_000;
let lastKick = 0;

async function kickBackgroundSync(origin: string) {
  try {
    const secret = process.env.CRON_SECRET;
    await fetch(`${origin}/api/sync-emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
    });
  } catch (err) {
    console.warn("[api/emails] background sync kick failed:", err);
  }
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  // Opportunistically trigger ingestion after we respond (throttled).
  const now = Date.now();
  if (now - lastKick > SYNC_THROTTLE_MS) {
    lastKick = now;
    const origin = req.nextUrl.origin;
    try { after(() => kickBackgroundSync(origin)); } catch { /* `after` unavailable — skip */ }
  }
  try {
    const emails = await getAllEmails();
    return NextResponse.json({ ok: true, emails }, { headers: CORS });
  } catch (err) {
    console.error("[api/emails] failed:", err);
    return NextResponse.json(
      { ok: false, emails: [], error: (err as Error).message },
      { status: 500, headers: CORS }
    );
  }
}
