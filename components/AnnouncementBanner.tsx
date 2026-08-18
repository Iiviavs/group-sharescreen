"use client";

import { useEffect, useRef, useState } from "react";
import { useSignaling } from "@/lib/useSignaling";
import { AnnouncementBar } from "./AnnouncementBar";
import { getHiddenAnnouncementIds, hideAnnouncementId } from "@/lib/announcement";
import { trackEvent } from "@/lib/analytics";

// Site-wide, rendered once in the root layout — not scoped to any room.
// Two things permanently hide a given announcement id (persisted, so it
// stays hidden across a reload/reconnect, not just this mount):
//   1. The person dismissed it via "x" (only possible when the admin marked
//      it dismissible).
//   2. It's a "reload"-action one — those only ever make sense once, so the
//      moment it's actually shown it's marked as already-seen for next time
//      without hiding it *this* time (so the person can still read it and
//      click the button now).
// A non-dismissible, non-reload announcement has neither escape hatch and
// stays up until the admin clears or replaces it — that's intentional.
export function AnnouncementBanner() {
  const state = useSignaling();
  const announcement = state.announcement;

  // Loaded once per mount — ids already dealt with in a previous
  // session/reload. A live dismiss (below) is tracked separately so it can
  // hide the banner immediately without waiting for a remount.
  const [hiddenIds] = useState(() => getHiddenAnnouncementIds());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // Per-mount only (unlike hiddenIds/localStorage) — just stops a brief
  // signaling reconnect from re-firing "announcement_shown" for the same
  // id it already reported this page load.
  const trackedShownIds = useRef<Set<string>>(new Set());

  const willShow =
    announcement != null && !hiddenIds.has(announcement.id) && !dismissedIds.has(announcement.id);

  useEffect(() => {
    if (!announcement || !willShow) return;
    if (announcement.buttonAction === "reload" && !hiddenIds.has(announcement.id)) {
      hideAnnouncementId(announcement.id);
    }
    if (!trackedShownIds.current.has(announcement.id)) {
      trackedShownIds.current.add(announcement.id);
      trackEvent("announcement_shown", {
        id: announcement.id,
        color: announcement.color,
        buttonAction: announcement.buttonAction,
        dismissible: announcement.dismissible,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [announcement, willShow]);

  if (!willShow || !announcement) return null;

  return (
    <AnnouncementBar
      announcement={announcement}
      onButtonClick={() =>
        trackEvent("announcement_button_clicked", {
          id: announcement.id,
          color: announcement.color,
          buttonAction: announcement.buttonAction,
        })
      }
      onDismiss={() => {
        hideAnnouncementId(announcement.id);
        setDismissedIds((prev) => new Set(prev).add(announcement.id));
        trackEvent("announcement_dismissed", { id: announcement.id, color: announcement.color });
      }}
    />
  );
}
