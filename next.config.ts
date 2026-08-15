import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // sharp ships a platform-specific native binary (libvips). Turbopack's
  // build tracer doesn't reliably bundle it for Vercel's Linux runtime
  // unless it's marked external — without this, every route that imports
  // sharp (even indirectly, e.g. lib/image-compress.ts) crashes at runtime
  // with ERR_DLOPEN_FAILED: libvips-cpp.so... cannot open shared object file.
  serverExternalPackages: ["sharp"],
  // serverExternalPackages alone isn't enough: sharp resolves its libvips
  // binary (@img/sharp-libvips-linux-x64) through a dynamically computed
  // require() path, which Vercel's static file tracer can't follow — so the
  // binary still gets dropped from the deployed function unless explicitly
  // included here.
  outputFileTracingIncludes: {
    "/api/upload/claim-document": ["./node_modules/@img/**/*", "./node_modules/sharp/**/*"],
  },
};

export default nextConfig;
