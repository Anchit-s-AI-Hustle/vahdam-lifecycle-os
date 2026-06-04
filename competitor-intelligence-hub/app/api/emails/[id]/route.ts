/**
 * GET /api/emails/[id]/html-ish — returns the raw HTML for one email row.
 *
 * Kept separate from /api/emails so the dashboard table payload stays small;
 * the detail slide-over fetches the (potentially large) HTML only when opened.
 * `id` is the sheet row number (as set by rowToRecord).
 */
import { NextRequest, NextResponse } from "next/server";
import { getEmailHtml } from "@/lib/google-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rowNumber = Number(params.id);
  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    return NextResponse.json({ ok: false, html: "" }, { status: 400 });
  }
  try {
    const html = await getEmailHtml(rowNumber);
    return NextResponse.json(
      { ok: true, html },
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (err) {
    console.error("[api/emails/:id] failed:", err);
    return NextResponse.json(
      { ok: false, html: "", error: (err as Error).message },
      { status: 500 }
    );
  }
}
