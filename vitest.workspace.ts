import { fileURLToPath } from "node:url";
import { defineWorkspace } from "vitest/config";
import react from "@vitejs/plugin-react";

const srcAlias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

export default defineWorkspace([
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
]);
