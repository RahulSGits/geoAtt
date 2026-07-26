import type { NextConfig } from 'next'

/**
 * These were previously declared through `metadata.other`, which renders
 * `<meta name="Content-Security-Policy">`. A `name=` meta is inert — only
 * `http-equiv` (or a real header) is honoured, and X-Frame-Options is ignored
 * in meta form entirely. Serving them as headers is what actually applies them.
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // Next's inline bootstrap needs 'unsafe-inline'; tfjs (behind face-api)
      // compiles kernels via `new Function`, which needs 'unsafe-eval'.
      // maps.googleapis.com is required by the optional Google Maps site view;
      // without it the loader retries forever with "Failed to load Google Maps script".
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline'",
      // blob: covers camera frame captures; the tile host serves the site map.
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.supabase.co https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com",
      "worker-src 'self' blob:",
      "media-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Only the check-in flow needs these, and only from this origin.
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
]

const nextConfig: NextConfig = {
  allowedDevOrigins: ['localhost', '127.0.0.1', '*.trycloudflare.com'],

  turbopack: {
    root: __dirname,
  },

  // Note: the previous wildcard CORS block on /api/* is deliberately gone.
  // `Access-Control-Allow-Origin: *` together with `Allow-Credentials: true` is
  // rejected by browsers anyway, and these routes are same-origin only.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // face-api weights are content-stable; let the browser keep them.
        source: '/models/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]
  },
}

export default nextConfig
