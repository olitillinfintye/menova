/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Needle Engine ships untranspiled ESM + decorators.
  transpilePackages: ["@needle-tools/engine"],
  async headers() {
    return [
      {
        // WebXR + SharedArrayBuffer-friendly isolation for the viewer routes.
        source: "/viewer/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Permissions-Policy", value: "xr-spatial-tracking=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
