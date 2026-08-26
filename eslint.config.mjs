import next from "eslint-config-next/core-web-vitals";

// Next.js 16 fjernede `next lint`; eslint-config-next leverer native flat config.

/**
 * Lag-grænser som lint-regel — ikke som hensigt.
 *
 * ADR 0002 låste lag-grænsen og noterede at den "håndhæves i review; kan senere
 * håndhæves med en lint-regel". Der er reelt ingen review (solo-repo, 0 påkrævede
 * godkendelser på `main`), så grænsen var indtil nu kun beskyttet af hukommelse.
 * Reglerne nedenfor er derfor forebyggende: de skal stå FØR den første forkerte
 * import, ikke skrives bagefter. Ingen af dem har overtrædelser i dag.
 */

/**
 * Tredjeparts-SDK'er for sub-processorer. Må KUN importeres inde i `src/lib/<modul>/`,
 * hvor adapteren bor (arkitekturprincip 2 i CLAUDE.md: leverandører skal kunne skiftes
 * uden at røre kernedomænet). Flere pakker er endnu ikke installeret — listen er med
 * vilje på forkant af fase 3/4.
 *
 * Supabase står bevidst IKKE her: det er sandhedskilden (arkitekturprincip 1), ikke en
 * udskiftelig sub-processor, og `src/server/**` bruger legitimt dens typer.
 */
const VENDOR_SDKS = [
  "stripe",
  "@stripe/*",
  "@calcom/*",
  "resend",
  "posthog-js",
  "posthog-node",
  "@anthropic-ai/*",
  "openai",
  "twilio",
  "@daily-co/*",
];

/**
 * Moduler der aldrig må nå klient-bundlen. `supabase-server` eksporterer
 * `createServiceSupabase`, som bevidst **bypasser RLS** — den hører kun til server-side
 * bag et eksplicit ejerskabstjek. `@/lib` bærer leverandørnøgler.
 *
 * Bemærk: `src/components/**` må fortsat importere `import type { … } from "@/server/…"`
 * (typer forsvinder ved compile takket være `verbatimModuleSyntax`) og server-actions —
 * det er det kanoniske Next-mønster og bruges allerede. Kun de farlige moduler er lukket.
 */
const CLIENT_FORBIDDEN = [
  "@/server/auth/supabase-server",
  "@/server/auth/supabase-client",
  "@/server/auth/provisioning",
  "@/lib",
  "@/lib/*",
  "@supabase/*",
  "next/headers",
];

const VENDOR_MESSAGE =
  "Tredjeparts-SDK'er må kun importeres i src/lib/<modul>/ (adapter-/port-mønstret, ADR 0004). Gå gennem porten i @/lib i stedet.";

const CLIENT_MESSAGE =
  "Server-only modul i klient-laget. createServiceSupabase bypasser RLS, og @/lib bærer leverandørnøgler — ingen af delene må nå klient-bundlen. Brug en server-action eller `import type`.";

const config = [
  { ignores: ["node_modules/**", ".next/**", "out/**", "coverage/**"] },
  ...next,

  // Adapter-grænsen: SDK'er kun i src/lib/**.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: VENDOR_SDKS, message: VENDOR_MESSAGE }] },
      ],
    },
  },

  // Klient-grænsen: src/components/** er præsentation. Gentager SDK-gruppen, fordi
  // flat config lader det sidste matchende objekt vinde for samme regel.
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: VENDOR_SDKS, message: VENDOR_MESSAGE },
            { group: CLIENT_FORBIDDEN, message: CLIENT_MESSAGE },
          ],
        },
      ],
    },
  },
];

export default config;
