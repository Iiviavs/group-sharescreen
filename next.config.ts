import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/bot",
        destination: "https://discord.com/oauth2/authorize?client_id=1540460243270635600",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;