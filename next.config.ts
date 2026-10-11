import type { NextConfig } from "next";

import { staticHeaderRules } from "./src/server/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Statiske sikkerhedsheadere (fase 6.2, ADR 0070). CSP med nonce kan ikke stå her — den er
  // unik pr. request og sættes i src/proxy.ts.
  async headers() {
    return staticHeaderRules();
  },
};

export default nextConfig;
