/**
 * runSync() — the competitor-mail ingestion engine (ported into Lifecycle OS).
 *
 * Connect to Gmail IMAP, fetch UNSEEN messages, mark them \Seen, extract the
 * fields, upload assets + a full-length screenshot to Drive, and append one row
 * per email to the Google Sheet. Every per-email step is wrapped so one failure
 * logs a sentinel and the loop continues.
 *
 * This is the same logic the standalone hub ran as /api/sync-emails, now living
 * in-repo so the whole feature is served from this single deployment.
 */
import {
  appendEmailRow,
  ensureHeaderRow,
  getExistingKeys,
  getFolders,
  uploadToDrive,
  SUBFOLDERS,
} from "./google-client";
import { extractAssets, extractSender, fetchUnreadEmails } from "./imap";
import {
  buildPreview,
  cleanBrandName,
  extractPromoCodes,
  htmlToText,
  joinOrNone,
} from "./extract";
import { renderEmailScreenshot } from "./screenshot";
import { NO_SCREENSHOT, RAW_HTML_MAX, type SyncResult } from "./types";

export async function runSync(): Promise<SyncResult> {
  const started = Date.now();
  const errors: string[] = [];
  let appended = 0;

  // Ensure the sheet has its header and resolve Drive folders up front.
  await ensureHeaderRow();
  const [folders, existingKeys] = await Promise.all([
    getFolders(),
    getExistingKeys(),
  ]);

  const emails = await fetchUnreadEmails(25);

  for (const { parsed } of emails) {
    try {
      const { displayName, address } = extractSender(parsed);
      const brand = cleanBrandName(displayName, address);
      const subject = parsed.subject || "(no subject)";
      const receivedAt = (parsed.date || new Date()).toISOString();

      const fullHtml = parsed.html || parsed.textAsHtml || "";
      const bodyText =
        (parsed.text && parsed.text.trim()) || htmlToText(fullHtml);
      const preview = buildPreview(bodyText);
      const promoCodes = joinOrNone(
        extractPromoCodes(`${subject}\n${bodyText}`)
      );

      // Belt-and-braces de-dupe (in case a message wasn't marked read).
      const dedupeKey = `${address}|${subject}|${receivedAt}`;
      if (existingKeys.has(dedupeKey)) continue;

      // Drive asset management.
      const assets = extractAssets(parsed);
      const inlineLinks: string[] = [];
      const attachmentLinks: string[] = [];

      for (const asset of assets) {
        try {
          const folderId = asset.inline
            ? folders.sub[SUBFOLDERS.inlineImages]
            : folders.sub[SUBFOLDERS.attachments];
          const link = await uploadToDrive({
            buffer: asset.buffer,
            filename: `${brand.replace(/[^\w]+/g, "_")}_${asset.filename}`,
            mimeType: asset.mimeType,
            folderId,
          });
          (asset.inline ? inlineLinks : attachmentLinks).push(link);
        } catch (err) {
          console.error("[sync] asset upload failed:", err);
          errors.push(`asset upload (${brand}): ${(err as Error).message}`);
        }
      }

      // Screenshot generation — failures never block the row.
      let screenshotUrl = NO_SCREENSHOT;
      try {
        const shot = await renderEmailScreenshot(fullHtml);
        if (shot) {
          try {
            screenshotUrl = await uploadToDrive({
              buffer: shot.buffer,
              filename: `${brand.replace(/[^\w]+/g, "_")}_${Date.now()}.png`,
              mimeType: shot.mimeType,
              folderId: folders.sub[SUBFOLDERS.screenshots],
            });
          } catch (driveErr) {
            console.warn(
              "[sync] screenshot Drive upload failed, using hosted URL:",
              driveErr
            );
            screenshotUrl = shot.hostedUrl;
          }
        }
      } catch (err) {
        console.error("[sync] screenshot failed:", err);
        errors.push(`screenshot (${brand}): ${(err as Error).message}`);
        screenshotUrl = NO_SCREENSHOT;
      }

      await appendEmailRow({
        brand,
        senderEmail: address,
        receivedAt,
        subject,
        preview,
        bodyText,
        promoCodes,
        screenshotUrl,
        inlineImageUrls: joinOrNone(inlineLinks),
        attachmentUrls: joinOrNone(attachmentLinks),
        rawHtml: fullHtml.slice(0, RAW_HTML_MAX),
      });

      existingKeys.add(dedupeKey);
      appended++;
    } catch (err) {
      console.error("[sync] failed to process email:", err);
      errors.push((err as Error).message || "unknown error");
    }
  }

  return {
    ok: true,
    processed: emails.length,
    appended,
    errors,
    durationMs: Date.now() - started,
  };
}
