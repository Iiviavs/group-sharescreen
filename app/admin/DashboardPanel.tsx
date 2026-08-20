"use client";

import { StatsOverview } from "./StatsOverview";
import { AnnouncementPanel } from "./AnnouncementPanel";
import { PartnerAdsPanel } from "./PartnerAdsPanel";
import { BannedWordsPanel } from "./BannedWordsPanel";
import { IpBansPanel } from "./IpBansPanel";

export function DashboardPanel() {
  return (
    <div className="flex flex-col gap-6">
      <StatsOverview />
      <AnnouncementPanel />
      <PartnerAdsPanel />
      <BannedWordsPanel />
      <IpBansPanel />
    </div>
  );
}
