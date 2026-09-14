import type { NextConfig } from "next";
import { OPT_OUT_BLOCKED_SOURCE, OPT_OUT_HOST } from "./src/lib/opt-out-host";
import { SITE_ORIGIN, dataOptOutPath } from "./src/lib/routes";

// Relative imports, not the `@/` alias: `next.config.ts` is loaded before the
// tsconfig paths those aliases come from are in play. Both modules are pure —
// no imports of their own, nothing framework-bound — so pulling them in here
// costs nothing and keeps the host policy and the URL shapes each defined once.

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

  // Confines optout.talentprotocol.com to the opt-out flow. See
  // src/lib/opt-out-host.ts for the policy itself and for why these are
  // routing rules rather than middleware.
  async redirects() {
    return [
      // The bare root is the one path someone who only half-remembers this
      // domain is likely to type directly. Bouncing that straight off to the
      // main site would send them away from the exact thing this domain
      // exists for, so it gets its own redirect, to the form itself, staying
      // on this host. Listed first because rules are evaluated in order, and
      // the catch-all below must not get to `/` ahead of it. Its destination
      // is in the allowlist, so this can never redirect into another redirect.
      {
        source: "/",
        has: [{ type: "host", value: OPT_OUT_HOST }],
        destination: `https://${OPT_OUT_HOST}${dataOptOutPath()}`,
        permanent: false,
      },
      // Everything the allowlist doesn't cover leaves for the main site.
      {
        source: OPT_OUT_BLOCKED_SOURCE,
        has: [{ type: "host", value: OPT_OUT_HOST }],
        destination: SITE_ORIGIN,
        permanent: false,
      },
      // `permanent: false` on both, i.e. 307 rather than 308: temporary, so
      // browsers never cache either one past a change in the domain's routing.
    ];
  },
};

export default nextConfig;
