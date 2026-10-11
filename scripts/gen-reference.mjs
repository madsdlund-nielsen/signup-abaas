#!/usr/bin/env node
/**
 * Kodegenereret reference (fase 6.5, ADR 0069): `npm run docs:reference`.
 *
 * Skriver tre filer i docs/reference/, alle udledt af koden — intet er tastet ind:
 *   routes.md   alle ruter i src/app + route handlers, metode og adgang (udledt; usikre markeret)
 *   schema.md   tabeller, kolonner, RLS og policies, parset fra supabase/migrations/*.sql
 *   env.md      miljøvariabler fra .env.example, med launch-krav fra launch-data.json
 *
 *   npm run docs:reference             generér
 *   npm run docs:reference -- --check  skriv intet; exit 1 hvis filerne afviger fra koden
 *
 * `--check` er ikke sat i CI endnu (ADR 0069): flere PR'er ad gangen ville gøre hver af dem rød
 * for en fil de ikke selv rørte. Kør den lokalt eller som rådgivende trin.
 *
 * Reglerne bor i scripts/lib/reference-core.mjs (testet); dette er kun I/O.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveRoutes,
  gateRule,
  launchRequirementsOf,
  parseEnvExample,
  parseMigrations,
  parseScheduled,
  renderEnv,
  renderRoutes,
  renderSchema,
} from "./lib/reference-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

function walk(dir, extensions) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path, extensions));
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
  return files.sort();
}

const read = (path) => readFileSync(join(root, path), "utf8");
const posix = (path) => path.split("\\").join("/");

const appDir = join(root, "src", "app");
const appFiles = walk(appDir, new Set([".ts", ".tsx"])).map((path) => ({
  path: posix(relative(appDir, path)),
  text: readFileSync(path, "utf8"),
}));

const functionsDir = join(root, "netlify", "functions");
const scheduled = parseScheduled(
  walk(functionsDir, new Set([".ts", ".mjs", ".js"])).map((path) => ({
    path: posix(relative(root, path)),
    text: readFileSync(path, "utf8"),
  })),
);

const migrationsDir = join(root, "supabase", "migrations");
const migrations = walk(migrationsDir, new Set([".sql"])).map((path) => ({
  name: relative(migrationsDir, path),
  text: readFileSync(path, "utf8"),
}));

const launchData = JSON.parse(read("src/server/admin/launch-data.json"));

const outputs = {
  "routes.md": renderRoutes(
    deriveRoutes(appFiles),
    scheduled,
    gateRule(read("src/proxy.ts"), read("src/server/gate/index.ts")),
  ),
  "schema.md": renderSchema(
    parseMigrations(migrations),
    migrations.map((m) => m.name),
  ),
  "env.md": renderEnv(parseEnvExample(read(".env.example")), launchRequirementsOf(launchData)),
};

const outDir = join(root, "docs", "reference");

if (check) {
  const stale = Object.entries(outputs)
    .filter(([name, text]) => {
      const path = join(outDir, name);
      return !existsSync(path) || readFileSync(path, "utf8") !== text;
    })
    .map(([name]) => name);
  if (stale.length > 0) {
    console.error(`Referencen er forældet: ${stale.join(", ")}. Kør «npm run docs:reference» og commit resultatet.`);
    process.exit(1);
  }
  console.log("Referencen er ajour.");
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, text] of Object.entries(outputs)) {
    writeFileSync(join(outDir, name), text.endsWith("\n") ? text : `${text}\n`);
    console.log(`docs/reference/${name}`);
  }
}
