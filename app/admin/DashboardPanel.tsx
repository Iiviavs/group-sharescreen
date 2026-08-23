"use client";

import { StatsOverview } from "./StatsOverview";
import { AnnouncementPanel } from "./AnnouncementPanel";
import { PartnerAdsPanel } from "./PartnerAdsPanel";
import { AntiSpamPanel } from "./AntiSpamPanel";
import { BannedWordsPanel } from "./BannedWordsPanel";
import { IpBansPanel } from "./IpBansPanel";
import { SupportersPanel } from "./SupportersPanel";

export function DashboardPanel() {
  return (
    <div className="flex flex-col gap-6">
      <StatsOverview />
      <AnnouncementPanel />
      <PartnerAdsPanel />
      <SupportersPanel />
      <AntiSpamPanel />
      <BannedWordsPanel />
      <IpBansPanel />
    </div>
  );
}
