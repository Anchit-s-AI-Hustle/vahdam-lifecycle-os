"use client";

/**
 * Slide-over detail view (PART 2 §3). Opens when a table row is clicked and
 * shows full metadata, the cleaned body text, the embedded Drive screenshot,
 * and download buttons for any extracted assets.
 */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calendar,
  Mail,
  Tag,
  User,
  Paperclip,
  ImageIcon,
  Download,
  ExternalLink,
  FileWarning,
} from "lucide-react";
import type { CompetitorEmail } from "@/lib/types";
import {
  drivePreviewUrl,
  formatDate,
  shortLabel,
  splitLinks,
} from "@/lib/utils";

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="break-words text-sm text-foreground">{children}</div>
      </div>
    </div>
  );
}

export function EmailDetailSheet({
  email,
  open,
  onOpenChange,
}: {
  email: CompetitorEmail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!email) return null;

  const codes =
    email.promoCodes && email.promoCodes !== "None"
      ? email.promoCodes.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
  const attachments = splitLinks(email.attachmentUrls);
  const inlineImages = splitLinks(email.inlineImageUrls);
  // Screenshot can be a Drive link (embed via preview iframe) OR a provider-
  // hosted image URL (embed directly as <img>). Sentinels like "No Screenshot"
  // match neither and fall through to the graceful empty state below.
  const screenshotPreview = drivePreviewUrl(email.screenshotUrl);
  const screenshotImg =
    !screenshotPreview && /^https?:\/\//i.test(email.screenshotUrl)
      ? email.screenshotUrl
      : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        <SheetHeader className="space-y-1 border-b p-6 pr-12 text-left">
          <Badge variant="secondary" className="w-fit">
            {email.brand}
          </Badge>
          <SheetTitle className="text-xl leading-tight">
            {email.subject}
          </SheetTitle>
          <SheetDescription className="line-clamp-2">
            {email.preview}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-6 p-6">
            {/* Metadata block */}
            <section>
              <MetaRow icon={<User className="h-4 w-4" />} label="Brand">
                {email.brand}
              </MetaRow>
              <MetaRow icon={<Mail className="h-4 w-4" />} label="Sender">
                {email.senderEmail || "—"}
              </MetaRow>
              <MetaRow icon={<Calendar className="h-4 w-4" />} label="Received">
                {formatDate(email.receivedAt)}
              </MetaRow>
              <MetaRow icon={<Tag className="h-4 w-4" />} label="Promo Codes">
                {codes.length ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {codes.map((c) => (
                      <Badge key={c} variant="success" className="font-mono">
                        {c}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </MetaRow>
            </section>

            <Separator />

            {/* Cleaned body text */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Mailer Body
              </h3>
              <div className="max-h-72 overflow-y-auto rounded-lg border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-foreground">
                  {email.bodyText || "—"}
                </pre>
              </div>
            </section>

            {/* Attachments */}
            {attachments.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" /> Attachments (
                  {attachments.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {attachments.map((url, i) => (
                    <Button
                      key={url}
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-2"
                    >
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                        {shortLabel(url, i)}
                      </a>
                    </Button>
                  ))}
                </div>
              </section>
            )}

            {/* Inline images */}
            {inlineImages.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5" /> Inline Images (
                  {inlineImages.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {inlineImages.map((url, i) => (
                    <Button
                      key={url}
                      asChild
                      variant="outline"
                      size="sm"
                      className="gap-2"
                    >
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        {shortLabel(url, i)}
                      </a>
                    </Button>
                  ))}
                </div>
              </section>
            )}

            <Separator />

            {/* Full-length screenshot embedded from Drive */}
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Full Email Screenshot
              </h3>
              {screenshotPreview ? (
                <div className="overflow-hidden rounded-lg border">
                  <iframe
                    src={screenshotPreview}
                    title="Email screenshot"
                    className="h-[520px] w-full bg-white"
                    loading="lazy"
                  />
                </div>
              ) : screenshotImg ? (
                <div className="max-h-[520px] overflow-y-auto rounded-lg border bg-white">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotImg}
                    alt="Full email screenshot"
                    className="w-full"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center text-muted-foreground">
                  <FileWarning className="h-6 w-6" />
                  <p className="text-sm">No Screenshot</p>
                </div>
              )}
              {(screenshotPreview || screenshotImg) && (
                <Button
                  asChild
                  variant="link"
                  size="sm"
                  className="mt-1 px-0"
                >
                  <a
                    href={email.screenshotUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {screenshotPreview ? "Open in Google Drive" : "Open full image"}{" "}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
