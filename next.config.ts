import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'tempfile.aiquickdraw.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '*.harstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'mediahar.harstatic.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  serverExternalPackages: ['@ffmpeg-installer/ffmpeg', '@ffprobe-installer/ffprobe', 'fluent-ffmpeg'],
};

export default nextConfig;
