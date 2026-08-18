// Shared between the admin panel (which builds/sends one) and the live
// site-wide banner (which renders whatever the server currently has active)
// so both sides agree on the shape and the color→CSS mapping never drifts
// between the admin's preview and what real visitors actually see.

export type AnnouncementColor = "green" | "red" | "blue";
export type AnnouncementButtonAction = "open-new-tab" | "open-same-tab" | "reload";

export type Announcement = {
  id: string;
  text: string;
  buttonLabel: string;
  buttonAction: AnnouncementButtonAction;
  // Only meaningful for open-new-tab/open-same-tab — null for "reload".
  buttonUrl: string | null;
  color: AnnouncementColor;
  dismissible: boolean;
};

export const ANNOUNCEMENT_COLOR_PRESETS: Record<
  AnnouncementColor,
  { bg: string; text: string; label: string }
> = {
  green: { bg: "#065f46", text: "#ffffff", label: "Verde" },
  red: { bg: "#7f1d1d", text: "#ffffff", label: "Vermelho" },
  blue: { bg: "#1e3a8a", text: "#ffffff", label: "Azul" },
};
