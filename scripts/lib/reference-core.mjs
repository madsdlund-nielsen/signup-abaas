/**
 * Kodegenereret reference (fase 6.5, ADR 0069): rene dele af `scripts/gen-reference.mjs`.
 *
 * Alt her udledes af koden eller migrationerne — intet er tastet ind. Hvor udledningen er en
 * konvention eller en tekstmatch (hvem må kalde en rute?), står det som «udledt» eller «usikker»
 * i outputtet. Skemaet parses fra `create table`/`create policy` m.fl.; det der ikke genkendes
 * tælles og vises som «ikke udledt», aldrig gættet. Ingen tidsstempler: samme kode giver samme
 * tekst, så `npm run docs:reference -- --check` kan sammenligne.
 */

import { PORT_FLAG } from "./launch-core.mjs";

// --- Hjælpere -------------------------------------------------------------------------------

const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
const code = (text) => (text === "" || text == null ? "" : `\`${String(text).replace(/`/g, "'")}\``);
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const HEADER_NOTE =
  "> Genereret af `scripts/gen-reference.mjs` (`npm run docs:reference`). Redigér ikke i hånden — ret koden eller migrationerne og generér igen.";

// --- Ruter ----------------------------------------------------------------------------------

const METHOD_PATTERN =
  /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

/** `(auth)/login/page.tsx` → `/login`. Rutegrupper i parentes er ikke en del af URL'en. */
export function routePathOf(file) {
  const segments = file
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`;
}

/** Roller en fil KRÆVER: `!user.roles.includes("x")` foran en afvisning, eller `requireRole(user, "x")`. */
function rolesIn(text) {
  const roles = new Set();
  for (const match of text.matchAll(/!\s*\w+\.roles\.includes\(\s*["'](\w+)["']\s*\)/g)) roles.add(match[1]);
  for (const match of text.matchAll(/requireRole\([^,)]+,\s*["'](\w+)["']\s*\)/g)) roles.add(match[1]);
  return [...roles].sort();
}

/** Roller en fil blot forgrener på (`roles.includes("x")` uden afvisning). */
function branchRolesIn(text, required) {
  const roles = new Set();
  for (const match of text.matchAll(/roles\.includes\(\s*["'](\w+)["']\s*\)/g)) {
    if (!required.includes(match[1])) roles.add(match[1]);
  }
  return [...roles].sort();
}

const requiresLogin = (text) => /redirect\(\s*["']\/login["']\s*\)/.test(text) || /Ikke logget ind/.test(text);

/** Adgangsklassifikation for en route handler. */
export function classifyHandler(path, text) {
  if (/x-cron-secret/i.test(text)) {
    return { kind: "cron", label: "cron (header x-cron-secret mod CRON_SECRET)", certain: true };
  }
  if (/verify\w*Signature\s*\(/.test(text)) {
    return { kind: "webhook", label: "webhook (signatur verificeres før alt andet)", certain: true };
  }
  const roles = rolesIn(text);
  if (roles.length > 0) {
    return { kind: "rolle", label: `login + rolle ${roles.join(", ")}`, certain: true };
  }
  if (/\bgetCurrentUser\s*\(/.test(text) || /requireRole\s*\(/.test(text)) {
    // Kun login er bekræftet i filen. En rolle kan være kontrolleret i en delegeret funktion.
    const adminPath = /^\/(api\/)?admin\//.test(path.startsWith("/") ? path : `/${path}`);
    return {
      kind: "login",
      label: adminPath
        ? "login; rolle kontrolleres ikke i filen (sti under admin — formentlig i en delegeret funktion)"
        : "login; rolle kontrolleres ikke i filen",
      certain: false,
    };
  }
  return { kind: "uklar", label: "ingen guard fundet i filen", certain: false };
}

/** Adgangsklassifikation for en side. `layoutTexts` er ancestor-layouts, rodnærmest først. */
export function classifyPage(path, text, layoutTexts = []) {
  const all = [...layoutTexts, text];
  const roles = [...new Set(all.flatMap(rolesIn))].sort();
  const login = all.some(requiresLogin);
  if (roles.length > 0) return { kind: "rolle", label: `login + rolle ${roles.join(", ")}`, certain: true };
  if (login) {
    const branch = [...new Set(all.flatMap((t) => branchRolesIn(t, roles)))].sort();
    return {
      kind: "login",
      label: branch.length > 0 ? `login (indholdet forgrener på rolle: ${branch.join(", ")})` : "login",
      certain: true,
    };
  }
  if (/\[token\]/.test(path)) {
    return { kind: "token", label: "engangstoken i URL (kontrolleres på serveren)", certain: false };
  }
  return { kind: "uklar", label: "ingen guard fundet i filen — offentlig eller beskyttet andetsteds", certain: false };
}

/** Læser proxyens matcher og gate-undtagelserne. Returnerer en funktion path → tilstand. */
export function gateRule(proxyText, gateText) {
  const matcherLiteral = /matcher:\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(proxyText)?.[1];
  const pattern = matcherLiteral ? new RegExp(`^${matcherLiteral.replace(/\\\\/g, "\\")}$`) : null;
  const exemptBody = /function\s+isGateExempt[\s\S]*?\n}/.exec(gateText)?.[0] ?? "";
  const exactExempt = [...exemptBody.matchAll(/pathname\s*===\s*"([^"]+)"/g)].map((m) => m[1]);
  const prefixExempt = [...exemptBody.matchAll(/startsWith\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  return {
    matcher: matcherLiteral ?? null,
    exact: exactExempt,
    prefixes: prefixExempt,
    stateOf(path) {
      const concrete = path.replace(/\[[^\]]+\]/g, "x");
      if (pattern && !pattern.test(concrete)) return "udenfor proxyen";
      if (exactExempt.includes(concrete) || prefixExempt.some((prefix) => concrete.startsWith(prefix))) {
        return "undtaget";
      }
      return "bag porten";
    },
  };
}

/** Netlify scheduled functions: navn, cron og den rute de kalder. */
export function parseScheduled(files) {
  return files
    .map((file) => ({
      name: file.path.replace(/^.*\//, "").replace(/\.[a-z]+$/, ""),
      file: file.path,
      schedule: /schedule:\s*"([^"]+)"/.exec(file.text)?.[1] ?? null,
      calls: /\/api\/[a-z0-9/-]+/.exec(file.text)?.[0] ?? null,
    }))
    .filter((fn) => fn.schedule !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Alle ruter i `src/app`. `files` er `[{ path, text }]` med stier relativt til `src/app`.
 * Returnerer { pages, handlers } sorteret på rute.
 */
export function deriveRoutes(files) {
  const layouts = new Map();
  for (const file of files) {
    if (/(^|\/)layout\.tsx?$/.test(file.path)) layouts.set(file.path.split("/").slice(0, -1).join("/"), file.text);
  }
  const ancestorLayouts = (path) => {
    const parts = path.split("/").slice(0, -1);
    const texts = [];
    for (let i = 0; i <= parts.length; i += 1) {
      const text = layouts.get(parts.slice(0, i).join("/"));
      if (text !== undefined) texts.push(text);
    }
    return texts;
  };

  const pages = [];
  const handlers = [];
  for (const file of files) {
    const name = file.path.replace(/^.*\//, "");
    if (/^page\.tsx?$/.test(name)) {
      const access = classifyPage(file.path, file.text, ancestorLayouts(file.path));
      pages.push({ route: routePathOf(file.path), file: file.path, access });
    } else if (/^route\.tsx?$/.test(name)) {
      const methods = [...file.text.matchAll(METHOD_PATTERN)].map((m) => m[1] ?? m[2]);
      handlers.push({
        route: routePathOf(file.path),
        file: file.path,
        methods: [...new Set(methods)].sort(),
        access: classifyHandler(file.path, file.text),
        // Et handler under en admin-rute er bag layoutets guard hvis siden er det — handlers
        // gennemgår IKKE layouts i Next, så vi udleder kun af selve filen.
      });
    }
  }
  const byRoute = (a, b) => a.route.localeCompare(b.route);
  return { pages: pages.sort(byRoute), handlers: handlers.sort(byRoute) };
}

export function renderRoutes({ pages, handlers }, scheduled, gate) {
  const gateText = (route) => gate.stateOf(route);
  const out = [];
  out.push("# Reference: ruter");
  out.push("");
  out.push(HEADER_NOTE);
  out.push("");
  out.push(
    "Adgangen er **udledt af koden**: guards i selve filen eller i et overliggende `layout.tsx`, og for handlers " +
      "signatur-/hemmelighedstjek i filen. Hvor ingen guard kan findes står *usikker* — det er ikke det samme som " +
      "offentlig. Autorisationen i sidste instans er RLS i databasen, ikke denne tabel.",
  );
  out.push("");
  out.push("**Adgangsport (ADR 0020).** `src/proxy.ts` matcher:");
  out.push("");
  out.push(`    ${gate.matcher ?? "(ikke fundet)"}`);
  out.push("");
  out.push(
    `Undtaget porten (\`isGateExempt\`): ${[...gate.exact, ...gate.prefixes].map(code).join(", ") || "(ingen fundet)"}. ` +
      "*Udenfor proxyen* = ruten når aldrig porten (fx `/api/`, som i stedet bærer sin egen signatur eller hemmelighed).",
  );
  out.push("");
  out.push(`## Sider (${pages.length})`);
  out.push("");
  out.push("| Rute | Fil | Adgang | Udledning | Adgangsport |");
  out.push("|---|---|---|---|---|");
  for (const page of pages) {
    out.push(
      `| ${code(page.route)} | ${code(`src/app/${page.file}`)} | ${cell(page.access.label)} | ${page.access.certain ? "kode" : "usikker"} | ${gateText(page.route)} |`,
    );
  }
  out.push("");
  out.push(`## Route handlers (${handlers.length})`);
  out.push("");
  out.push("| Rute | Metoder | Fil | Adgang | Udledning | Adgangsport | Planlagt af |");
  out.push("|---|---|---|---|---|---|---|");
  for (const handler of handlers) {
    const scheduler = scheduled.find((fn) => fn.calls === handler.route);
    const planned =
      handler.access.kind === "cron"
        ? scheduler
          ? `${scheduler.name} (${code(scheduler.schedule)})`
          : "ingen scheduled function"
        : "";
    out.push(
      `| ${code(handler.route)} | ${handler.methods.join(", ") || "?"} | ${code(`src/app/${handler.file}`)} | ${cell(handler.access.label)} | ${handler.access.certain ? "kode" : "usikker"} | ${gateText(handler.route)} | ${planned} |`,
    );
  }
  out.push("");
  out.push(`## Planlagte funktioner (${scheduled.length})`);
  out.push("");
  if (scheduled.length === 0) {
    out.push("Ingen.");
  } else {
    out.push("| Funktion | Cron (UTC) | Kalder | Fil |");
    out.push("|---|---|---|---|");
    for (const fn of scheduled) {
      out.push(`| ${fn.name} | ${code(fn.schedule)} | ${code(fn.calls ?? "?")} | ${code(fn.file)} |`);
    }
  }
  out.push("");
  return out.join("\n");
}

// --- Skema ----------------------------------------------------------------------------------

/** Del SQL i sætninger: fjerner kommentarer, respekterer strenge, parenteser og `$$`-blokke. */
export function splitStatements(sql) {
  const statements = [];
  let current = "";
  let depth = 0;
  let dollarTag = null;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const n = sql[i + 1];
    if (dollarTag !== null) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
      } else {
        current += c;
        i += 1;
      }
      continue;
    }
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (c === "'") {
      current += c;
      i += 1;
      while (i < sql.length) {
        current += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            current += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i, i + 40));
      if (tag) {
        dollarTag = tag[0];
        current += tag[0];
        i += tag[0].length;
        continue;
      }
    }
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === ";" && depth === 0) {
      if (current.trim() !== "") statements.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  if (current.trim() !== "") statements.push(current.trim());
  return statements;
}

const squash = (text) => text.replace(/\s+/g, " ").trim();

/** Del på kommaer på øverste niveau (ikke inde i parenteser eller strenge). */
export function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      current += c;
      if (c === "'") inString = false;
      continue;
    }
    if (c === "'") {
      inString = true;
      current += c;
      continue;
    }
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/** Indholdet af den første parentes fra `start` (inkl. nøstede). Returnerer { inner, end } eller null. */
function balanced(text, start) {
  const open = text.indexOf("(", start);
  if (open === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === "'") inString = false;
      continue;
    }
    if (c === "'") inString = true;
    else if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

const CONSTRAINT_START = /^(constraint|primary key|unique|check|foreign key|exclude|like)\b/i;
const TYPE_STOP = /\s(?:not null|null|default|primary key|unique|references|check|generated|constraint|collate)\b/i;

/** Parse én kolonnedefinition: `navn type [not null] [default x] [references t(c)] …`. */
export function parseColumn(item) {
  const match = /^"?([A-Za-z_][\w]*)"?\s+(.*)$/s.exec(item.trim());
  if (!match) return null;
  const [, name, rest] = match;
  const stop = TYPE_STOP.exec(` ${rest}`);
  const type = squash(stop ? ` ${rest}`.slice(0, stop.index) : rest);
  const defaultMatch = /\bdefault\s+(.+?)(?=\s+(?:not null|null|primary key|unique|references|check|constraint|generated|collate)\b|$)/i.exec(rest);
  const references = /\breferences\s+([\w.]+)\s*(?:\(([^)]*)\))?(?:\s+on delete\s+(cascade|set null|restrict|no action))?/i.exec(rest);
  const primaryKey = /\bprimary key\b/i.test(rest);
  const checkAt = /\bcheck\s*\(/i.exec(rest);
  const check = checkAt ? balanced(rest, checkAt.index)?.inner : undefined;
  return {
    name,
    type,
    notNull: primaryKey || /\bnot null\b/i.test(rest),
    default: defaultMatch ? squash(defaultMatch[1]) : null,
    primaryKey,
    unique: /\bunique\b/i.test(rest) && !primaryKey,
    references: references
      ? { table: references[1].replace(/^public\./, ""), column: references[2]?.trim() ?? null, onDelete: references[3] ?? null }
      : null,
    check: check ? squash(check) : null,
  };
}

const tableName = (raw) => raw.replace(/^public\./i, "").replace(/"/g, "").toLowerCase();

/**
 * Parse migrationerne i filrækkefølge til et skema. `files` er `[{ name, text }]`.
 * Tæller de sætninger der ikke genkendes i `unparsed`, så det er synligt hvad der ikke er udledt.
 */
export function parseMigrations(files) {
  const tables = new Map();
  const enums = new Map();
  const views = new Map();
  const functions = new Map();
  const triggers = new Map();
  const unparsed = [];

  const table = (name, createdIn) => {
    const key = tableName(name);
    if (!tables.has(key)) {
      tables.set(key, { name: key, createdIn, columns: [], constraints: [], rls: false, policies: [] });
    }
    return tables.get(key);
  };

  const addColumn = (target, item) => {
    const column = parseColumn(item);
    if (!column) return false;
    const existing = target.columns.findIndex((c) => c.name === column.name);
    if (existing >= 0) target.columns[existing] = column;
    else target.columns.push(column);
    return true;
  };

  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    for (const raw of splitStatements(file.text)) {
      const sql = squash(raw);
      let m;

      if ((m = /^create type (\S+) as enum \((.*)\)$/i.exec(sql))) {
        enums.set(tableName(m[1]), {
          name: tableName(m[1]),
          createdIn: file.name,
          values: [...m[2].matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1].replace(/''/g, "'")),
        });
      } else if ((m = /^alter type (\S+) add value (?:if not exists )?'((?:[^']|'')*)'(?: (before|after) '((?:[^']|'')*)')?$/i.exec(sql))) {
        const target = enums.get(tableName(m[1]));
        if (target && !target.values.includes(m[2])) {
          const at = m[3] ? target.values.indexOf(m[4]) : -1;
          if (m[3] && at >= 0) target.values.splice(m[3].toLowerCase() === "after" ? at + 1 : at, 0, m[2]);
          else target.values.push(m[2]);
        }
      } else if ((m = /^create table (?:if not exists )?(\S+?)\s*\(/i.exec(sql))) {
        const target = table(m[1], file.name);
        const body = balanced(sql, m[0].length - 1);
        for (const item of splitTopLevel(body?.inner ?? "")) {
          if (CONSTRAINT_START.test(item)) target.constraints.push(squash(item));
          else if (!addColumn(target, item)) unparsed.push(`${file.name}: kolonne «${truncate(item, 60)}»`);
        }
      } else if ((m = /^alter table (?:only )?(?:if exists )?(\S+) (.*)$/is.exec(sql))) {
        const target = tables.get(tableName(m[1]));
        if (!target) {
          unparsed.push(`${file.name}: alter table på ukendt tabel ${m[1]}`);
          continue;
        }
        for (const action of splitTopLevel(m[2])) {
          let a;
          if (/^enable row level security$/i.test(action)) target.rls = true;
          else if (/^force row level security$/i.test(action)) continue;
          else if ((a = /^add column (?:if not exists )?(.*)$/is.exec(action))) addColumn(target, a[1]);
          else if ((a = /^drop column (?:if exists )?"?(\w+)"?/i.exec(action))) {
            target.columns = target.columns.filter((c) => c.name !== a[1]);
          } else if ((a = /^alter column "?(\w+)"? (drop not null|set not null)$/i.exec(action))) {
            const column = target.columns.find((c) => c.name === a[1]);
            if (column) column.notNull = /set not null/i.test(a[2]);
          } else if ((a = /^add constraint (\w+) (.*)$/is.exec(action))) {
            const text = squash(`constraint ${a[1]} ${a[2]}`);
            if (!target.constraints.includes(text)) target.constraints.push(text);
          } else if ((a = /^drop constraint (?:if exists )?(\w+)/i.exec(action))) {
            target.constraints = target.constraints.filter((c) => !new RegExp(`^constraint ${a[1]}\\b`, "i").test(c));
          } else {
            unparsed.push(`${file.name}: alter table ${target.name} ${truncate(action, 60)}`);
          }
        }
      } else if ((m = /^drop policy (?:if exists )?(\S+) on (\S+)$/i.exec(sql))) {
        const target = tables.get(tableName(m[2]));
        if (target) target.policies = target.policies.filter((p) => p.name !== m[1]);
      } else if ((m = /^create policy (\S+) on (\S+)(.*)$/is.exec(sql))) {
        const target = tables.get(tableName(m[2]));
        if (!target) {
          unparsed.push(`${file.name}: policy ${m[1]} på ukendt tabel ${m[2]}`);
          continue;
        }
        const rest = m[3];
        const command = /\bfor (all|select|insert|update|delete)\b/i.exec(rest)?.[1]?.toLowerCase() ?? "all";
        const roles = /\bto ([\w, ]+?)(?=\s+(?:using|with check)\b|$)/i.exec(rest)?.[1]?.trim() ?? null;
        const usingAt = /\busing\s*\(/i.exec(rest);
        const withCheckAt = /\bwith check\s*\(/i.exec(rest);
        target.policies.push({
          name: m[1],
          command,
          roles,
          using: usingAt ? squash(balanced(rest, usingAt.index)?.inner ?? "") : null,
          withCheck: withCheckAt ? squash(balanced(rest, withCheckAt.index)?.inner ?? "") : null,
          createdIn: file.name,
        });
      } else if ((m = /^create (?:or replace )?view (\S+)/i.exec(sql))) {
        views.set(tableName(m[1]), {
          name: tableName(m[1]),
          createdIn: file.name,
          securityInvoker: /security_invoker\s*=\s*true/i.test(sql),
        });
      } else if ((m = /^create (?:or replace )?function (\S+?)\s*\(/i.exec(sql))) {
        const args = balanced(sql, m[0].length - 1);
        const after = sql.slice(args?.end ?? 0);
        functions.set(tableName(m[1]), {
          name: tableName(m[1]),
          createdIn: file.name,
          args: squash(args?.inner ?? ""),
          returns: /\breturns\s+(.+?)(?=\s+(?:language|security|as|set|stable|volatile|immutable)\b|$)/i.exec(after)?.[1] ?? null,
          securityDefiner: /\bsecurity definer\b/i.test(sql.split(/\$[A-Za-z0-9_]*\$/)[0] ?? ""),
        });
      } else if ((m = /^create (?:or replace )?trigger (\S+) (.*?) on (\S+)/i.exec(sql))) {
        triggers.set(m[1], { name: m[1], when: squash(m[2]), table: tableName(m[3]), createdIn: file.name });
      } else if ((m = /^drop trigger (?:if exists )?(\S+) on/i.exec(sql))) {
        triggers.delete(m[1]);
      } else if ((m = /^drop function (?:if exists )?(\S+?)(?:\(|$)/i.exec(sql))) {
        functions.delete(tableName(m[1]));
      }
      // Alt andet (index, grant, revoke, comment, insert, do, create extension, set) er bevidst ikke udledt.
    }
  }

  const sorted = (map) => [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    tables: sorted(tables),
    enums: sorted(enums),
    views: sorted(views),
    functions: sorted(functions),
    triggers: sorted(triggers),
    unparsed,
  };
}

export function renderSchema(schema, migrationNames) {
  const { tables, enums, views, functions, triggers, unparsed } = schema;
  const withoutRls = tables.filter((t) => !t.rls);
  const rlsNoPolicies = tables.filter((t) => t.rls && t.policies.length === 0);
  const out = [];
  out.push("# Reference: databaseskema");
  out.push("");
  out.push(HEADER_NOTE);
  out.push("");
  out.push(
    `Udledt af ${migrationNames.length} migrationer i \`supabase/migrations/\` ved at læse \`create table\`, \`alter table\`, ` +
      "`create policy`/`drop policy`, `create type`, `create view`, `create function` og `create trigger` i filrækkefølge. " +
      "Det der ikke genkendes er talt nederst — ikke gættet. Indekser, `grant`/`revoke` og data-sætninger er ikke udledt.",
  );
  out.push("");
  out.push("## Overblik");
  out.push("");
  out.push(`- Tabeller: **${tables.length}**, heraf RLS slået til: **${tables.length - withoutRls.length}**`);
  out.push(
    `- Tabeller uden \`enable row level security\`: ${withoutRls.length === 0 ? "**ingen**" : withoutRls.map((t) => code(t.name)).join(", ")}`,
  );
  out.push(
    `- RLS slået til men uden nogen policy (alt afvises for klientroller; kun service-role): ${rlsNoPolicies.length === 0 ? "ingen" : rlsNoPolicies.map((t) => code(t.name)).join(", ")}`,
  );
  out.push(`- Policies i alt: **${tables.reduce((n, t) => n + t.policies.length, 0)}**`);
  out.push(`- Views: ${views.length} · Enum-typer: ${enums.length} · Funktioner: ${functions.length} · Triggere: ${triggers.length}`);
  out.push("");
  out.push("| Tabel | Kolonner | RLS | Policies | Oprettet i |");
  out.push("|---|---|---|---|---|");
  for (const t of tables) {
    out.push(`| [${code(t.name).replace(/`/g, "")}](#${t.name}) | ${t.columns.length} | ${t.rls ? "ja" : "**NEJ**"} | ${t.policies.length} | ${t.createdIn} |`);
  }
  out.push("");

  out.push("## Tabeller");
  out.push("");
  for (const t of tables) {
    out.push(`### ${t.name}`);
    out.push("");
    out.push(`Oprettet i \`${t.createdIn}\`. RLS: ${t.rls ? "slået til" : "**IKKE slået til**"}.`);
    out.push("");
    out.push("| Kolonne | Type | Null | Default | Bemærkning |");
    out.push("|---|---|---|---|---|");
    for (const c of t.columns) {
      const notes = [];
      if (c.primaryKey) notes.push("primær nøgle");
      if (c.unique) notes.push("unik");
      if (c.references) {
        const target = `${c.references.table}${c.references.column ? `(${c.references.column})` : ""}`;
        notes.push(`→ ${target}${c.references.onDelete ? ` on delete ${c.references.onDelete}` : ""}`);
      }
      if (c.check) notes.push(`check ${truncate(c.check, 80)}`);
      out.push(
        `| ${code(c.name)} | ${code(c.type)} | ${c.notNull ? "nej" : "ja"} | ${c.default ? code(c.default) : ""} | ${cell(notes.join("; "))} |`,
      );
    }
    out.push("");
    if (t.constraints.length > 0) {
      out.push("Tabelkonstraints:");
      out.push("");
      for (const constraint of t.constraints) out.push(`- ${code(truncate(constraint, 200))}`);
      out.push("");
    }
    if (t.policies.length > 0) {
      out.push("| Policy | Kommando | Roller | Using | With check |");
      out.push("|---|---|---|---|---|");
      for (const p of t.policies) {
        out.push(
          `| ${code(p.name)} | ${p.command} | ${p.roles ? code(p.roles) : "alle"} | ${p.using ? code(truncate(p.using, 240)) : ""} | ${p.withCheck ? code(truncate(p.withCheck, 240)) : ""} |`,
        );
      }
      out.push("");
    }
  }

  if (views.length > 0) {
    out.push("## Views");
    out.push("");
    out.push("| View | Security invoker | Oprettet i |");
    out.push("|---|---|---|");
    for (const v of views) out.push(`| ${code(v.name)} | ${v.securityInvoker ? "ja" : "nej"} | ${v.createdIn} |`);
    out.push("");
  }

  if (enums.length > 0) {
    out.push("## Enum-typer");
    out.push("");
    out.push("| Type | Værdier | Oprettet i |");
    out.push("|---|---|---|");
    for (const e of enums) out.push(`| ${code(e.name)} | ${e.values.map(code).join(", ")} | ${e.createdIn} |`);
    out.push("");
  }

  if (functions.length > 0) {
    out.push("## Funktioner");
    out.push("");
    out.push("| Funktion | Argumenter | Returnerer | Security definer | Oprettet i |");
    out.push("|---|---|---|---|---|");
    for (const f of functions) {
      out.push(
        `| ${code(f.name)} | ${f.args ? code(truncate(f.args, 160)) : ""} | ${f.returns ? code(f.returns) : ""} | ${f.securityDefiner ? "ja" : "nej"} | ${f.createdIn} |`,
      );
    }
    out.push("");
  }

  if (triggers.length > 0) {
    out.push("## Triggere");
    out.push("");
    out.push("| Trigger | Tabel | Hvornår | Oprettet i |");
    out.push("|---|---|---|---|");
    for (const t of triggers) out.push(`| ${code(t.name)} | ${code(t.table)} | ${cell(t.when)} | ${t.createdIn} |`);
    out.push("");
  }

  out.push("## Ikke udledt");
  out.push("");
  if (unparsed.length === 0) out.push("Alle `create table`/`alter table`/`create policy`-sætninger blev genkendt.");
  else {
    out.push(`${unparsed.length} sætninger blev ikke genkendt og er ikke med ovenfor:`);
    out.push("");
    for (const line of unparsed) out.push(`- ${cell(line)}`);
  }
  out.push("");
  return out.join("\n");
}

// --- Miljøvariabler -------------------------------------------------------------------------

/** Parse `.env.example` til sektioner af variabler med den kommentar der står umiddelbart over. */
export function parseEnvExample(text) {
  const sections = [];
  let section = { title: "Øvrigt", variables: [] };
  let comment = [];
  const flush = () => {
    if (section.variables.length > 0) sections.push(section);
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = /^#\s*---\s*(.*?)\s*---\s*$/.exec(line) ?? /^#\s*---\s*(.*)$/.exec(line);
    if (/^#\s*[─=]{5,}/.test(line)) {
      comment = [];
      continue;
    }
    if (heading) {
      flush();
      section = { title: heading[1].replace(/\s*---\s*$/, "").trim(), variables: [] };
      comment = [];
      continue;
    }
    const variable = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (variable) {
      section.variables.push({
        name: variable[1],
        example: variable[2].trim(),
        description: comment.join(" ").replace(/\s+/g, " ").trim(),
      });
      comment = [];
      continue;
    }
    if (line.startsWith("#")) {
      comment.push(line.replace(/^#\s?/, "").trim());
      continue;
    }
    if (line.trim() === "") comment = [];
  }
  flush();
  return sections;
}

export function renderEnv(sections, launchRequirements) {
  const total = sections.reduce((n, s) => n + s.variables.length, 0);
  const out = [];
  out.push("# Reference: miljøvariabler");
  out.push("");
  out.push(HEADER_NOTE);
  out.push("");
  out.push(
    `Udledt af \`.env.example\` (${total} variabler) og \`src/server/admin/launch-data.json\`. Variabler med \`NEXT_PUBLIC_\` er ` +
      "offentlige by design (de bundles ind i klienten); alt andet er server-only. Ingen værdier her er hemmelige: " +
      "eksemplet er tomt eller en offentlig standard. Produktionsværdier sættes i Netlify (Site configuration → Environment variables).",
  );
  out.push("");
  out.push("**Krav ved launch** er de variabler `/admin/klar` og `npm run launch:check` kræver sat.");
  out.push("");
  for (const section of sections) {
    out.push(`## ${section.title}`);
    out.push("");
    out.push("| Variabel | Synlighed | Krav ved launch | Eksempel/standard | Beskrivelse |");
    out.push("|---|---|---|---|---|");
    for (const v of section.variables) {
      out.push(
        `| ${code(v.name)} | ${v.name.startsWith("NEXT_PUBLIC_") ? "offentlig" : "server"} | ${cell(launchRequirements.get(v.name) ?? "")} | ${v.example ? code(v.example) : ""} | ${cell(v.description)} |`,
      );
    }
    out.push("");
  }
  return out.join("\n");
}

/** Variabel → hvad tjeklisten kræver den til, udledt af launch-data.json. */
export function launchRequirementsOf(data) {
  const map = new Map();
  const add = (names, text, minLength) => {
    for (const name of names) {
      const note = minLength ? `${text} (mindst ${minLength} tegn)` : text;
      map.set(name, map.has(name) ? `${map.get(name)}; ${note}` : note);
    }
  };
  for (const secret of data.generelleHemmeligheder) add(secret.anyOf, "platform", secret.minLength);
  for (const port of data.porte) {
    add([`FLAG_${PORT_FLAG[port.key]}`], `flag for port ${port.key} (tændt, når porten skal være rigtig)`);
    for (const key of [...port.factoryKeys, ...port.otherKeys]) add(key.anyOf, `port ${port.key}`, key.minLength);
  }
  add(["FLAG_DEMO"], "skal være slukket");
  for (const flag of data.oevrigeFlag) add([flag.env], `flag ${flag.flag}: ${flag.intent ?? "ikke dokumenteret"}`);
  return map;
}
