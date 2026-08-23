// Shared between the admin panel (which builds/sends the whole list) and
// the "Apoiar projeto" hover list (SupportersTooltip.tsx, which just
// renders whatever the server currently has) — mirrors
// server/supporterStore.ts's `Supporter` exactly, since there's nothing
// admin-only about either field.
export type Supporter = {
  name: string;
  amount: number;
};
