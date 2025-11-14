const nextConfig = {
  async redirects() {
    return [
      {
        source: '/',
        destination: '/explore',
        permanent: true, // Use `false` if you want a temporary redirect
      },
    ]
  },
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
