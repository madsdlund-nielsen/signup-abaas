#!/usr/bin/env node
/**
 * Go-live-kontrol fra kommandolinjen (fase 6.4, ADR 0069): `npm run launch:check`.
 *
 * Læser miljøet (process.env, evt. fra .env.local) og repoet, og siger hvad der står mellem os og
 * launch: demo-flag, integrationernes tilstand, manglende hemmeligheder (kun «sat/mangler» — aldrig
 * værdier), åbne beslutninger, TODO-markører i src/ og supabase/, rækker i stub-registret, åbne
 * backlog-punkter og huller i ADR-indekset. Exit-kode 1 når noget blokerer, ellers 0.
 *
 *   npm run launch:check                 tekst
 *   npm run launch:check -- --report     markdown til stdout
 *   npm run launch:check -- --report=FIL markdown til en fil
 *   npm run launch:check -- --skip-env   kun repoet (fx i CI uden produktionsmiljø)
 *
 * Alle regler bor i scripts/lib/launch-core.mjs (testet); dette er kun I/O.
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLaunchReport,
  checkAdrIndex,
  countStubRegisterRows,
  countTodoMarkers,
  parseOpenBacklog,
  renderMarkdown,
  renderText,
} from "./lib/launch-core.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".sql", ".css", ".json", ".md"]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      files.push(...walk(path));
    } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

const read = (path) => readFileSync(join(root, path), "utf8");

const args = process.argv.slice(2);
const skipEnv = args.includes("--skip-env");
const reportArg = args.find((arg) => arg === "--report" || arg.startsWith("--report="));

const data = JSON.parse(read("src/server/admin/launch-data.json"));

const scanned = ["src", "supabase"]
  .flatMap((dir) => walk(join(root, dir)))
  .map((path) => ({ path: relative(root, path), text: readFileSync(path, "utf8") }));

const report = buildLaunchReport({
  data,
  env: process.env,
  skipEnv,
  todo: countTodoMarkers(scanned),
  stubRegister: countStubRegisterRows(read("docs/stub-register.md")),
  backlog: parseOpenBacklog(read("docs/backlog.md")),
  adr: checkAdrIndex(read("docs/adr/README.md"), readdirSync(join(root, "docs/adr"))),
});

if (reportArg) {
  const markdown = renderMarkdown(report);
  const target = reportArg.startsWith("--report=") ? reportArg.slice("--report=".length) : null;
  if (target) {
    writeFileSync(join(process.cwd(), target), markdown);
    console.log(`Rapport skrevet til ${target}.`);
  } else {
    console.log(markdown);
  }
} else {
  console.log(renderText(report));
}

process.exit(report.ready ? 0 : 1);
