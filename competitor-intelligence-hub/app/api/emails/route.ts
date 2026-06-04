/**
 * GET /api/emails — read-only endpoint the dashboard uses for SWR refresh.
 * Returns all rows from the Google Sheet as CompetitorEmail[].
 */
import { NextResponse } from "next/server";
import { getAllEmails } from "@/lib/google-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const emails = await getAllEmails();
    return NextResponse.json(
      { ok: true, emails },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[api/emails] failed:", err);
    return NextResponse.json(
      { ok: false, emails: [], error: (err as Error).message },
      { status: 500 }
    );
  }
}
