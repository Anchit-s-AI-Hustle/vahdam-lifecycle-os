/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // imapflow / mailparser / googleapis are Node-only libraries. Keep them external
    // so Next does not bundle their native/optional deps into the serverless function.
    serverComponentsExternalPackages: ["imapflow", "mailparser", "googleapis"],
    // Enable `unstable_after()` (Next 14.2) so /api/emails can kick a background
    // mail sync after responding — gives near-real-time ingestion while the
    // dashboard is open, without an external cron.
    after: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "drive.google.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
