"use client";

import { ANNOUNCEMENT_COLOR_PRESETS, type Announcement } from "@/lib/announcement";

// Pure presentational — reused both by the real site-wide banner
// (AnnouncementBanner, wired to signalingClient) and by the admin panel's
// preview button, so what the admin sees while composing one is pixel-for-
// pixel what visitors get.
export function AnnouncementBar({
  announcement,
  onDismiss,
}: {
  announcement: Announcement;
  onDismiss?: () => void;
}) {
  const preset = ANNOUNCEMENT_COLOR_PRESETS[announcement.color];

  function handleButtonClick() {
    if (announcement.buttonAction === "reload") {
      window.location.reload();
      return;
    }
    if (!announcement.buttonUrl) return;
    if (announcement.buttonAction === "open-new-tab") {
      window.open(announcement.buttonUrl, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = announcement.buttonUrl;
    }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium"
      style={{ backgroundColor: preset.bg, color: preset.text }}
    >
      <p className="min-w-0 flex-1 break-words">{announcement.text}</p>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={handleButtonClick}
          className="rounded-md border px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
          style={{ borderColor: preset.text, color: preset.text }}
        >
          {announcement.buttonLabel}
        </button>
        {announcement.dismissible && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Fechar aviso"
            title="Fechar aviso"
            className="text-lg leading-none opacity-80 transition hover:opacity-100"
            style={{ color: preset.text }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
