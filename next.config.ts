import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Suppress Turbopack "Module not found" errors for the unresolved optional
    // @x402/* deps of @coinbase/cdp-sdk. They are only reached inside cdp-sdk's
    // x402 payment-signing action, pulled in via RainbowKit's default Base
    // Account connector — a flow this read-only scoring app never exercises.
    // Shape per node_modules/next/dist/docs/.../turbopackIgnoreIssue.md
    // (`path` is required; `title` RegExp narrows to module-not-found only).
    ignoreIssue: [
      { path: /@coinbase[\\/]cdp-sdk/, title: /Module not found/ },
    ],
  },
};

export default nextConfig;
