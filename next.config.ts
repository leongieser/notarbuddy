import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@google-cloud/vision",
    "@napi-rs/canvas",
    "pdfjs-dist",
  ],
};

export default nextConfig;
