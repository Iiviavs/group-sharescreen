import type { MetadataRoute } from "next";

const SITE_URL = "https://golive.nemtudo.me";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/rooms`,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 0.6,
    },
  ];
}
