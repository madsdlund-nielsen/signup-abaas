import { defineConfig } from "vitest/config";

// Rod-konfiguration for tværgående options (projekter defineres i vitest.workspace.ts).
// Coverage scopes til den enhedstestede flade, så `npm run test:coverage` er en
// meningsfuld, ikke-flaky tærskel.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/components/**", "src/server/flags/**"],
      reporter: ["text", "html"],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 },
    },
  },
});
