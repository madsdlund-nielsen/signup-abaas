/**
 * Go-live-kontrollens rene dele (fase 6.4, ADR 0069). Ingen filsystem, ingen process.env som
 * skjult input: `scripts/launch-check.mjs` læser filerne og miljøet og sender dem hertil, så
 * hver regel kan testes på en streng (`tests/unit/launch-check.test.ts`).
 *
 * Miljødelen spejler `src/server/admin/launch-env.ts` + `readiness.ts` (som /admin/klar bruger).
 * Dobbeltarbejdet er bevidst: CLI'en kan ikke importere TypeScript med stialiasser. Paritets-
 * testen (`tests/integration/launch-parity.test.ts`) kører begge side om side og mod de rigtige
 * adapter-factorier, så de ikke kan glide fra hinanden.
 */

const TRUTHY = new Set(["1", "true", "on", "yes"]);

export function flagIsOn(env, name) {
  const value = env[name];
  return value != null && TRUTHY.has(value.trim().toLowerCase());
}

/** Tilstedeværelse af ét krav: "sat" | "mangler" | "for-kort". Aldrig værdien eller dens længde. */
export function checkKey(env, requirement) {
  let state = "mangler";
  for (const name of requirement.anyOf) {
    const value = env[name]?.trim() ?? "";
    if (value === "") continue;
    if (requirement.minLength !== undefined && value.length < requirement.minLength) {
      if (state === "mangler") state = "for-kort";
      continue;
    }
    state = "sat";
    break;
  }
  return { label: requirement.label, envNames: requirement.anyOf, state };
}

/**
 * Hvilken tilstand en port ville have, udledt af flag + nøgler + hvad der er bygget — samme
 * rækkefølge som factorierne: rigtig først, demo kun når rigtig config mangler, ellers stub.
 */
export function derivePortMode(data, port, env) {
  const factory = port.factoryKeys.map((key) => checkKey(env, key));
  const configured = factory.every((key) => key.state === "sat");
  const portFlag = `FLAG_${PORT_FLAG[port.key]}`;
  if (flagIsOn(env, portFlag) && configured && port.realAdapterBuilt) return "real";
  if (flagIsOn(env, "FLAG_DEMO") && !configured && port.demoAdapterBuilt) return "demo";
  return "stub";
}

/** Portens nøgle → navnet på dens feature-flag (FLAG_<NAVN>). Spejler `PORTS` i integrations.ts. */
export const PORT_FLAG = {
  booking: "BOOKING",
  video: "VIDEO",
  payments: "PAYMENTS",
  accounting: "ACCOUNTING",
  llm: "AIFOLLOWUP",
  transcription: "TRANSCRIPTION",
  email: "EMAIL",
  sms: "SMS",
  analytics: "ANALYTICS",
};

/** Miljøtjekket: demo, porte, hemmeligheder, øvrige flag og adgangsport. Returnerer blokeringer. */
export function evaluateEnv(data, env) {
  const blockers = [];
  const demoOn = flagIsOn(env, "FLAG_DEMO");
  if (demoOn) blockers.push({ area: "demo", message: "FLAG_DEMO er tændt — skal være slukket ved launch." });

  const ports = data.porte.map((port) => {
    const mode = derivePortMode(data, port, env);
    const factory = port.factoryKeys.map((key) => checkKey(env, key));
    const other = port.otherKeys.map((key) => checkKey(env, key));
    const complete = [...factory, ...other].every((key) => key.state === "sat");
    const acceptedStub = mode === "stub" && port.accepted !== null;
    let verdict = "blokerer";
    let reason;
    if (mode === "real") {
      verdict = complete ? "klar" : "blokerer";
      reason = complete ? "kører mod leverandøren" : "kører, men en tilhørende hemmelighed mangler";
    } else if (acceptedStub) {
      verdict = "klar";
      reason = `bevidst stub, accepteret af ${port.accepted.by}`;
    } else if (mode === "demo") {
      reason = "kører som demo";
    } else if (!port.realAdapterBuilt) {
      reason = "ingen rigtig adapter i koden endnu";
    } else if (!flagIsOn(env, `FLAG_${PORT_FLAG[port.key]}`)) {
      reason = `FLAG_${PORT_FLAG[port.key]} er slukket`;
    } else {
      reason = "flaget er tændt, men nøglerne mangler";
    }
    if (verdict === "blokerer") blockers.push({ area: "porte", message: `${port.key}: ${reason}` });

    for (const status of [...factory, ...other]) {
      if (acceptedStub || status.state === "sat") continue;
      blockers.push({
        area: "hemmeligheder",
        message: `${status.envNames.join(" eller ")} ${status.state === "for-kort" ? "er for kort" : "mangler"} (${port.key})`,
      });
    }
    return { key: port.key, mode, verdict, reason, factory, other };
  });

  const secrets = data.generelleHemmeligheder.map((secret) => checkKey(env, secret));
  for (const status of secrets) {
    if (status.state === "sat") continue;
    blockers.push({
      area: "hemmeligheder",
      message: `${status.envNames.join(" eller ")} ${status.state === "for-kort" ? "er for kort" : "mangler"}`,
    });
  }

  const flags = data.oevrigeFlag.map((entry) => {
    // inAppMessaging er hårdkodet slukket i koden uanset miljø (src/server/flags).
    const enabled = entry.flag === "inAppMessaging" ? false : flagIsOn(env, entry.env);
    let verdict = "klar";
    let reason = enabled ? "tændt" : "slukket";
    if (entry.intent === null) {
      verdict = "blokerer";
      reason = "ikke dokumenteret som bevidst tændt eller slukket";
    } else if ((entry.intent === "tændt") !== enabled) {
      verdict = "blokerer";
      reason = `er ${enabled ? "tændt" : "slukket"}, men dokumenteret som bevidst ${entry.intent}`;
    }
    if (verdict === "blokerer") blockers.push({ area: "flag", message: `${entry.flag}: ${reason}` });
    return { flag: entry.flag, enabled, verdict, reason };
  });

  const gateEnabled = env.APP_GATE_ENABLED === "true";
  const gateActive = gateEnabled && env.APP_GATE_PASSWORD_HASH != null && env.APP_GATE_COOKIE_SECRET != null;
  const gatePartial = gateEnabled && !gateActive;
  if (gatePartial) {
    blockers.push({ area: "adgangsport", message: "APP_GATE_ENABLED er sat, men hash eller cookie-hemmelighed mangler — porten er inaktiv." });
  }

  return { demoOn, ports, secrets, flags, gate: { active: gateActive, partial: gatePartial }, blockers };
}

/** Åbne beslutninger i datafilen (dem uden parkering). */
export function openDecisions(data) {
  return data.beslutninger.filter((decision) => decision.parked === null);
}

// --- Repoet ---------------------------------------------------------------------------------

// Mønstret bygges ud af dele, så denne fil ikke selv tæller som en markør hvis den nogensinde
// scannes. Matcher markørerne for ejer- og Mads-punkter.
const TODO_PATTERN = new RegExp(`TODO${"\\("}(ejer|mads)${"\\)"}`, "g");

/** Tæl TODO-markører. `files` er `[{ path, text }]`. */
export function countTodoMarkers(files) {
  const totals = { ejer: 0, mads: 0 };
  const perFile = [];
  for (const file of files) {
    const own = { ejer: 0, mads: 0 };
    for (const match of file.text.matchAll(TODO_PATTERN)) own[match[1]] += 1;
    if (own.ejer + own.mads > 0) {
      perFile.push({ path: file.path, ejer: own.ejer, mads: own.mads });
      totals.ejer += own.ejer;
      totals.mads += own.mads;
    }
  }
  perFile.sort((a, b) => b.ejer + b.mads - (a.ejer + a.mads) || a.path.localeCompare(b.path));
  return { ...totals, total: totals.ejer + totals.mads, files: perFile };
}

function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isSeparator = (line) => /^\|?\s*:?-{2,}/.test(line.trim());

/**
 * Datarækker i markdown-tabeller: [{ section, cells }]. En overskriftsrække er en tabellinje der
 * umiddelbart efterfølges af en skillerække; den og skillerækken springes over. Tabellinjer
 * tæller som rækker også hvis en tom linje har brudt tabellen op (det sker i backloggen).
 */
export function tableRows(markdown) {
  const rows = [];
  const lines = markdown.split(/\r?\n/);
  let section = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!line.trim().startsWith("|")) continue;
    if (isSeparator(line)) continue;
    if (isSeparator(lines[i + 1] ?? "") && (lines[i + 1] ?? "").trim().startsWith("|")) continue;
    rows.push({ section, cells: cells(line) });
  }
  return rows;
}

/** Sektioner i stub-registret der ikke er huller (jf. dets egne forklaringer). */
const NON_STUB_SECTIONS = [/^Demo-implementeringer/i, /^Bevidst tomme/i];

/**
 * Rækker i stub-registret. En række hvis første celle er helt overstreget (~~…~~) er lukket og tæller
 * ikke. Demo-implementeringer og «bevidst tomme» er ikke stubs.
 */
export function countStubRegisterRows(markdown) {
  const perSection = {};
  let total = 0;
  for (const row of tableRows(markdown)) {
    if (NON_STUB_SECTIONS.some((pattern) => pattern.test(row.section))) continue;
    const first = row.cells[0] ?? "";
    if (/^~~.*~~$/.test(first)) continue;
    perSection[row.section] = (perSection[row.section] ?? 0) + 1;
    total += 1;
  }
  return { total, perSection };
}

/** Åbne backlog-punkter: rækker med et B-nummer i første celle, foran «Lukkede punkter». */
export function parseOpenBacklog(markdown) {
  const open = [];
  for (const row of tableRows(markdown)) {
    if (/^Lukkede punkter/i.test(row.section)) continue;
    const id = /^\*\*(B-\d+)\*\*$/.exec(row.cells[0] ?? "");
    if (id) open.push(id[1]);
  }
  return open;
}

/**
 * ADR-indekset mod mappen. `fileNames` er filnavnene i docs/adr. Et nummer er et hul hvis det
 * mangler både fil og indekslinje inde i rækken; en indekslinje markeret «nummer reserveret» er et
 * dokumenteret, bevidst tomrum og tæller ikke.
 */
export function checkAdrIndex(indexMarkdown, fileNames) {
  const fileNumbers = new Map();
  for (const name of fileNames) {
    const match = /^(\d{4})-.+\.md$/.exec(name);
    if (match) fileNumbers.set(match[1], name);
  }
  const indexed = new Map();
  for (const line of indexMarkdown.split(/\r?\n/)) {
    const match = /^\|\s*(\d{4})\s*\|(.*)$/.exec(line);
    if (match) indexed.set(match[1], match[2]);
  }
  const reserved = [...indexed.entries()]
    .filter(([number, rest]) => !fileNumbers.has(number) && /nummer reserveret/i.test(rest))
    .map(([number]) => number);
  const filesWithoutIndexLine = [...fileNumbers.keys()].filter((number) => !indexed.has(number)).sort();
  const indexLinesWithoutFile = [...indexed.keys()]
    .filter((number) => !fileNumbers.has(number) && !reserved.includes(number))
    .sort();
  const all = [...new Set([...fileNumbers.keys(), ...indexed.keys()])].map(Number).sort((a, b) => a - b);
  const sequenceGaps = [];
  if (all.length > 0) {
    for (let n = all[0]; n <= all[all.length - 1]; n += 1) {
      const key = String(n).padStart(4, "0");
      if (!fileNumbers.has(key) && !indexed.has(key)) sequenceGaps.push(key);
    }
  }
  return {
    files: fileNumbers.size,
    indexLines: indexed.size,
    reserved,
    filesWithoutIndexLine,
    indexLinesWithoutFile,
    sequenceGaps,
  };
}

/** Saml miljø + repo til én rapport med en samlet blokeringsliste. */
export function buildLaunchReport({ data, env, skipEnv = false, todo, stubRegister, backlog, adr }) {
  const blockers = [];
  const envResult = skipEnv ? null : evaluateEnv(data, env);
  if (envResult) blockers.push(...envResult.blockers);

  const decisions = openDecisions(data);
  for (const decision of decisions) {
    blockers.push({ area: "beslutninger", message: `${decision.owner}: ${decision.title}` });
  }
  if (todo.total > 0) {
    blockers.push({ area: "todo", message: `${todo.total} TODO-markører i src/ og supabase/ (${todo.ejer} ejer, ${todo.mads} Mads)` });
  }
  if (stubRegister.total > 0) {
    blockers.push({ area: "stub-register", message: `${stubRegister.total} rækker i stub-registret uden eksplicit accept` });
  }
  if (backlog.length > 0) {
    blockers.push({ area: "backlog", message: `${backlog.length} åbne backlog-punkter (${backlog.join(", ")})` });
  }
  for (const number of adr.filesWithoutIndexLine) {
    blockers.push({ area: "adr", message: `ADR ${number} har en fil men ingen linje i indekset` });
  }
  for (const number of adr.indexLinesWithoutFile) {
    blockers.push({ area: "adr", message: `ADR ${number} står i indekset uden fil` });
  }
  for (const number of adr.sequenceGaps) {
    blockers.push({ area: "adr", message: `ADR ${number} mangler helt (hverken fil eller indekslinje)` });
  }

  return { env: envResult, decisions, todo, stubRegister, backlog, adr, blockers, ready: blockers.length === 0 };
}

const AREA_LABEL = {
  demo: "Demo-tilstand",
  porte: "Integrationer",
  hemmeligheder: "Hemmeligheder",
  flag: "Øvrige flag",
  adgangsport: "Adgangsport",
  beslutninger: "Åbne beslutninger",
  todo: "TODO-markører",
  "stub-register": "Stub-register",
  backlog: "Backlog",
  adr: "ADR-indeks",
};

/** Kort tekst til terminalen. */
export function renderText(report) {
  const lines = [];
  lines.push("Go-live-kontrol");
  lines.push("");
  if (report.env) {
    lines.push(`Demo-tilstand        ${report.env.demoOn ? "TÆNDT (blokerer)" : "slukket"}`);
    lines.push("Integrationer");
    for (const port of report.env.ports) {
      lines.push(`  ${port.key.padEnd(14)} ${port.mode.padEnd(5)} ${port.verdict.padEnd(9)} ${port.reason}`);
    }
    const missing = report.blockers.filter((b) => b.area === "hemmeligheder").length;
    lines.push(`Hemmeligheder        ${missing === 0 ? "alle sat" : `${missing} mangler`}`);
    lines.push(`Adgangsport          ${report.env.gate.active ? "aktiv" : report.env.gate.partial ? "delvist sat (inaktiv)" : "slukket"}`);
  } else {
    lines.push("Miljø                sprunget over (--skip-env)");
  }
  lines.push(`Åbne beslutninger    ${report.decisions.length}`);
  lines.push(`TODO-markører        ${report.todo.total} (${report.todo.ejer} ejer, ${report.todo.mads} Mads)`);
  lines.push(`Stub-register        ${report.stubRegister.total} rækker`);
  lines.push(`Backlog              ${report.backlog.length} åbne punkter`);
  lines.push(
    `ADR-indeks           ${report.adr.files} filer, ${report.adr.indexLines} indekslinjer, ` +
      `${report.adr.filesWithoutIndexLine.length + report.adr.indexLinesWithoutFile.length + report.adr.sequenceGaps.length} huller` +
      (report.adr.reserved.length > 0 ? ` (reserveret: ${report.adr.reserved.join(", ")})` : ""),
  );
  lines.push("");
  lines.push(report.ready ? "KLAR: intet blokerer." : `BLOKERET: ${report.blockers.length} punkter står mellem os og launch.`);
  return lines.join("\n");
}

/** Markdown-rapport (`--report`). Ingen tidsstempel: samme tilstand giver samme tekst. */
export function renderMarkdown(report) {
  const out = [];
  out.push("# Go-live-kontrol");
  out.push("");
  out.push(report.ready ? "**Status: klar** — intet blokerer." : `**Status: blokeret** — ${report.blockers.length} punkter.`);
  out.push("");
  out.push("| Område | Antal |");
  out.push("|---|---|");
  const counts = {};
  for (const blocker of report.blockers) counts[blocker.area] = (counts[blocker.area] ?? 0) + 1;
  for (const [area, label] of Object.entries(AREA_LABEL)) {
    out.push(`| ${label} | ${counts[area] ?? 0} |`);
  }
  out.push("");
  if (report.env) {
    out.push("## Integrationer");
    out.push("");
    out.push("| Port | Kører | Status | Note |");
    out.push("|---|---|---|---|");
    for (const port of report.env.ports) {
      out.push(`| ${port.key} | ${port.mode} | ${port.verdict} | ${port.reason} |`);
    }
    out.push("");
  }
  out.push("## Blokeringer");
  out.push("");
  if (report.blockers.length === 0) out.push("Ingen.");
  for (const blocker of report.blockers) {
    out.push(`- **${AREA_LABEL[blocker.area] ?? blocker.area}:** ${blocker.message}`);
  }
  out.push("");
  out.push("## Repoet");
  out.push("");
  out.push(`- TODO-markører: ${report.todo.total} (${report.todo.ejer} ejer, ${report.todo.mads} Mads)`);
  for (const file of report.todo.files.slice(0, 10)) {
    out.push(`  - \`${file.path}\`: ${file.ejer + file.mads}`);
  }
  out.push(`- Stub-register: ${report.stubRegister.total} rækker`);
  for (const [section, count] of Object.entries(report.stubRegister.perSection)) {
    out.push(`  - ${section}: ${count}`);
  }
  out.push(`- Åbne backlog-punkter: ${report.backlog.length}`);
  out.push(`- ADR-indeks: ${report.adr.files} filer, ${report.adr.indexLines} indekslinjer`);
  out.push("");
  return out.join("\n");
}
