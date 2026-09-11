import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Vitest-konfiguration (ADR 0003, opdateret i ADR 0033).
 *
 * De tre projekter lå tidligere i `vitest.workspace.ts`. Vitest 3 markerer workspace-filen
 * som deprecated og fjerner den i næste major — projekterne bor derfor nu i `test.projects`
 * her. Lagene og deres stier er UÆNDREDE; kun hvor de er defineret har flyttet sig.
 * Se `tests/CLAUDE.md` for hvornår hvilket lag bruges.
 */

const srcAlias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias: srcAlias },
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup/unit.ts"],
        },
      },
      {
        resolve: { alias: srcAlias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: srcAlias },
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          globalSetup: ["tests/setup/db-global.ts"],
        },
      },
    ],

    // Coverage scopes til den enhedstestede flade, så `npm run test:coverage` er en
    // meningsfuld, ikke-flaky tærskel. Tærsklen håndhæves i CI (ADR 0028).
    // Tærskeltallene er revideret i ADR 0040: Vitest 5 gør AST-aware remapping til
    // standard i v8-provideren, så tælleenheden skiftede og de gamle 70/70/70/60 målte
    // ikke længere det samme. Functions bliver på 70 indtil OptionsSection.tsx er testet
    // (backlog B-16).
    coverage: {
      provider: "v8",
      include: ["src/components/**", "src/server/flags/**", "src/server/auth/**"],
      // supabase-client.ts er SDK-/request-glue (next/headers + @supabase/*); den dækkes
      // af integration/manuel verifikation, ikke unit-tests, så den holdes ude af tærsklen.
      // actions.ts er server-actions oven på Supabase — samme kategori som
      // supabase-client.ts, og dækkes af integration/manuel verifikation.
      // supabase-server.ts er tredje fil i samme kategori: den konstruerer request-scopede
      // klienter og har ingen egen logik. Den stod allerede på 0 % linjer; først med
      // AST-aware remapping (Vitest 5) talte dens funktioner med i tærsklen.
      exclude: [
        "src/server/auth/supabase-client.ts",
        "src/server/auth/supabase-server.ts",
        "src/server/auth/actions.ts",
      ],
      reporter: ["text", "html"],
      thresholds: { lines: 75, functions: 70, statements: 75, branches: 70 },
    },
  },
});
