import type { NextConfig } from "next";

// Browser hardening for every page. The API sets its own headers (helmet).
// The CSP only restricts what never needs to vary (framing, <base>, plugins, form targets); a script-src
// policy needs per-request nonces for Next's inline hydration scripts, which would make every page dynamic.
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Geolocation stays available to this site for "use my location" searches.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)" },
  // Ignored by browsers over plain HTTP, so harmless while SITE_DOMAIN=:80.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Emits .next/standalone with a minimal server.js so the production image
  // ships without node_modules. See the Docker stage in ./Dockerfile.
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
