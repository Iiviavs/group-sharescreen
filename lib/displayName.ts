// Single source of truth for the "(guest)" suffix so it reads identically
// everywhere a participant's name is shown — ParticipantRow, VideoTile
// labels, ChatPanel messages, and the admin moderation views. `isGuest`
// comes from the server (see signaling.ts's peerSummary/chat "isGuest"
// field) — undefined (an older server, or a value nobody bothered to set)
// is treated the same as `false`, i.e. no suffix.
export function withGuestSuffix(name: string, isGuest?: boolean): string {
  return isGuest ? `${name} (guest)` : name;
}
