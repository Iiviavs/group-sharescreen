// Shared between the admin panel (which builds/sends one) and the sidebar
// partner-ad slot (PartnerCard.tsx, which renders whatever the server
// currently has active) — mirrors server/partnerStore.ts's `Partner`, minus
// the admin-only `weight`/`createdAt` fields a regular visitor never needs
// (see server/signaling.ts's publicPartner).
export type Partner = {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor: string | null;
  textColor: string | null;
  buttonBackgroundColor: string | null;
  buttonTextColor: string | null;
  // epoch ms; null = never expires. PartnerCard.tsx schedules a local timer
  // off this so an active ad disappears the instant it expires, without
  // waiting for a reload or a live socket update.
  expiresAt: number | null;
};
