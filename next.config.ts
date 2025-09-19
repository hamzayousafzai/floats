import type { NextConfig } from "next";

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  eslint: {
      // Allow deploys even if ESLint finds problems
      ignoreDuringBuilds: true,
    },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "inxlsvowzpqvfulhbnou.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
