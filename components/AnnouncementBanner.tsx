"use client";

import { useState } from "react";
import { useSignaling } from "@/lib/useSignaling";
import { AnnouncementBar } from "./AnnouncementBar";

// Site-wide, rendered once in the root layout — not scoped to any room.
// Dismissal is local-only (dismissedId) and intentionally the *one* way to
// get rid of it when the admin marked it dismissible: there's no timeout,
// no auto-hide on navigation, nothing else clears it. A new announcement
// (different id) always shows again even if the previous one was dismissed.
export function AnnouncementBanner() {
  const state = useSignaling();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const announcement = state.announcement;

  if (!announcement || announcement.id === dismissedId) return null;

  return (
    <AnnouncementBar announcement={announcement} onDismiss={() => setDismissedId(announcement.id)} />
  );
}
