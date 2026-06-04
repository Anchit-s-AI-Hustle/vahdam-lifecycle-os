/**
 * GET /api/emails — read-only endpoint the dashboard uses for SWR refresh.
 * Returns all rows from the Google Sheet as CompetitorEmail[].
 */
import { NextResponse } from "next/server";
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

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
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
