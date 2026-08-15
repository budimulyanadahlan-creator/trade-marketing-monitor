import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // sharp ships a platform-specific native binary (libvips). Turbopack's
  // build tracer doesn't reliably bundle it for Vercel's Linux runtime
  // unless it's marked external — without this, every route that imports
  // sharp (even indirectly, e.g. lib/image-compress.ts) crashes at runtime
  // with ERR_DLOPEN_FAILED: libvips-cpp.so... cannot open shared object file.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
