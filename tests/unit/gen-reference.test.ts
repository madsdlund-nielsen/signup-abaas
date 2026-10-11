import { describe, expect, it } from "vitest";

import {
  classifyHandler,
  classifyPage,
  deriveRoutes,
  gateRule,
  launchRequirementsOf,
  parseColumn,
  parseEnvExample,
  parseMigrations,
  parseScheduled,
  renderEnv,
  renderRoutes,
  renderSchema,
  routePathOf,
  splitStatements,
  splitTopLevel,
} from "../../scripts/lib/reference-core.mjs";

/**
 * Referencegeneratorens rene dele (ADR 0069). Alt udledes af tekst: rutefiler, migrationer og
 * `.env.example`. Testene holder generatoren ærlig — den må aldrig gætte, og skal sige når den ikke ved.
 */

describe("routePathOf", () => {
  it("fjerner rutegrupper men beholder dynamiske segmenter", () => {
    expect(routePathOf("(auth)/login/page.tsx")).toBe("/login");
    expect(routePathOf("page.tsx")).toBe("/");
    expect(routePathOf("admin/boards/[id]/page.tsx")).toBe("/admin/boards/[id]");
  });
});

describe("classifyHandler", () => {
  it("genkender cron, webhook og rolle — og er ærlig når kun login findes", () => {
    expect(classifyHandler("api/cron/x/route.ts", 'headers.get("x-cron-secret")').kind).toBe("cron");
    expect(classifyHandler("api/webhooks/x/route.ts", "if (!verifyFooSignature(body)) return").kind).toBe("webhook");
    const admin = classifyHandler("admin/x/route.ts", 'if (!user.roles.includes("admin")) return 403; await getCurrentUser()');
    expect(admin).toMatchObject({ kind: "rolle", label: "login + rolle admin", certain: true });

    const loginOnly = classifyHandler("api/admin/x/route.ts", "const user = await getCurrentUser();");
    expect(loginOnly).toMatchObject({ kind: "login", certain: false });
    expect(loginOnly.label).toContain("sti under admin");

    expect(classifyHandler("api/y/route.ts", "export async function GET() {}")).toMatchObject({
      kind: "uklar",
      certain: false,
    });
  });
});

describe("classifyHandler — engangstoken fra mail (ADR 0073)", () => {
  it("genkender verifyOtp som et engangstoken, ikke som en uklar rute", () => {
    expect(classifyHandler("auth/confirm/route.ts", "await supabase.auth.verifyOtp({ type, token_hash })")).toMatchObject({
      kind: "token",
      certain: false,
    });
  });
});

describe("classifyPage", () => {
  const guarded = 'const user = await getCurrentUser(); if (!user) redirect("/login");';

  it("kræver rolle når siden afviser uden den, og forgrener bare når den kun spørger", () => {
    const required = classifyPage("a/page.tsx", `${guarded} if (!user.roles.includes("ejer")) redirect("/dashboard");`);
    expect(required.label).toBe("login + rolle ejer");

    const branching = classifyPage("a/page.tsx", `${guarded} const x = user.roles.includes("admin");`);
    expect(branching.label).toBe("login (indholdet forgrener på rolle: admin)");
    expect(branching.certain).toBe(true);
  });

  it("arver guarden fra et overliggende layout", () => {
    const layout = 'if (!user) redirect("/login"); if (!user.roles.includes("admin")) redirect("/dashboard");';
    expect(classifyPage("admin/x/page.tsx", "export default function P() {}", [layout]).label).toBe(
      "login + rolle admin",
    );
  });

  it("markerer en side uden guard som usikker — ikke som offentlig", () => {
    const result = classifyPage("login/page.tsx", "export default function P() {}");
    expect(result).toMatchObject({ kind: "uklar", certain: false });
    expect(result.label).toContain("offentlig eller beskyttet andetsteds");
  });

  it("markerer en tokenrute", () => {
    expect(classifyPage("vurdering/[token]/page.tsx", "x").kind).toBe("token");
    // En omdirigering til login med forklaring (`?fejl=`) er også et loginkrav.
    expect(classifyPage("konto/adgangskode/page.tsx", 'if (!user) redirect("/login?fejl=ny-adgangskode");').kind).toBe("login");
  });
});

describe("deriveRoutes og renderRoutes", () => {
  const files = [
    { path: "layout.tsx", text: "export default function L() {}" },
    { path: "admin/layout.tsx", text: 'if (!user) redirect("/login"); if (!user.roles.includes("admin")) redirect("/");' },
    { path: "admin/page.tsx", text: "x" },
    { path: "(auth)/login/page.tsx", text: "x" },
    { path: "api/cron/job/route.ts", text: 'export async function POST() { headers.get("x-cron-secret") }' },
    { path: "api/hook/route.ts", text: "export const POST = async () => {}; export async function GET() {} verifyFooSignature(x)" },
  ];

  it("udleder sider, handlers og metoder, sorteret på rute", () => {
    const { pages, handlers } = deriveRoutes(files);
    expect(pages.map((p) => p.route)).toEqual(["/admin", "/login"]);
    expect(handlers.map((h) => [h.route, h.methods])).toEqual([
      ["/api/cron/job", ["POST"]],
      ["/api/hook", ["GET", "POST"]],
    ]);
  });

  it("renderer med planlægning og adgangsport — deterministisk", () => {
    const routes = deriveRoutes(files);
    const gate = gateRule(
      'export const config = { matcher: ["/((?!api/|_next/static).*)"] };',
      'export function isGateExempt(pathname: string): boolean {\n  return pathname === "/gate" || pathname.startsWith("/vurdering/");\n}',
    );
    const scheduled = parseScheduled([
      { path: "netlify/functions/job.ts", text: 'fetch(`${u}/api/cron/job`); export const config = { schedule: "0 3 * * *" };' },
      { path: "netlify/functions/helper.ts", text: "// ingen plan" },
    ]);
    expect(scheduled).toEqual([
      { name: "job", file: "netlify/functions/job.ts", schedule: "0 3 * * *", calls: "/api/cron/job" },
    ]);
    const md = renderRoutes(routes, scheduled, gate);
    expect(md).toBe(renderRoutes(routes, scheduled, gate));
    expect(md).toContain("| `/api/cron/job` | POST |");
    expect(md).toContain("job (`0 3 * * *`)");
    expect(md).toContain("udenfor proxyen");
    expect(md).toContain("bag porten");
    expect(md).not.toMatch(/20\d\d-\d\d-\d\d/);
  });
});

describe("gateRule", () => {
  const gate = gateRule(
    'matcher: ["/((?!api/|_next/static).*)"]',
    'export function isGateExempt(pathname: string): boolean {\n  return pathname === "/gate" || pathname.startsWith("/vurdering/");\n}',
  );
  it("udleder matcher og undtagelser af koden", () => {
    expect(gate.exact).toEqual(["/gate"]);
    expect(gate.prefixes).toEqual(["/vurdering/"]);
    expect(gate.stateOf("/api/cron/x")).toBe("udenfor proxyen");
    expect(gate.stateOf("/gate")).toBe("undtaget");
    expect(gate.stateOf("/vurdering/[token]")).toBe("undtaget");
    expect(gate.stateOf("/admin")).toBe("bag porten");
  });
});

describe("splitStatements", () => {
  it("respekterer kommentarer, strenge og dollar-citerede blokke", () => {
    const sql = `
      -- en kommentar med ; og 'apostrof
      create table a (x text default 'a;b', y int); /* blok ; */
      create function f() returns void language plpgsql as $$ begin perform 1; perform 2; end $$;
      select 1;`;
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain("default 'a;b'");
    expect(parts[1]).toContain("perform 1; perform 2;");
  });
});

describe("splitTopLevel", () => {
  it("deler ikke inde i parenteser eller strenge", () => {
    expect(splitTopLevel("a numeric(6,4), b text default 'x,y', c int check (c in (1,2))")).toEqual([
      "a numeric(6,4)",
      "b text default 'x,y'",
      "c int check (c in (1,2))",
    ]);
  });
});

describe("parseColumn", () => {
  it("udleder type, null, default, nøgler og referencer", () => {
    expect(parseColumn("id uuid primary key default gen_random_uuid()")).toMatchObject({
      name: "id",
      type: "uuid",
      notNull: true,
      primaryKey: true,
      default: "gen_random_uuid()",
    });
    expect(parseColumn("board_id uuid not null unique references board(id) on delete cascade")).toMatchObject({
      type: "uuid",
      notNull: true,
      unique: true,
      references: { table: "board", column: "id", onDelete: "cascade" },
    });
    expect(parseColumn("factor numeric(6,4) not null check (factor > 0)")).toMatchObject({
      type: "numeric(6,4)",
      check: "factor > 0",
    });
    expect(parseColumn("note text")).toMatchObject({ notNull: false, default: null });
  });
});

describe("parseMigrations", () => {
  const files = [
    {
      name: "0001_a.sql",
      text: `
        create type kind as enum ('a', 'b');
        create table thing (
          id uuid primary key default gen_random_uuid(),
          kind kind not null default 'a',
          owner_id uuid not null references owner(id) on delete cascade,
          unique (owner_id, kind)
        );
        alter table thing enable row level security;
        create policy thing_select_owner on thing for select using (owner_id = auth.uid());
        create policy thing_select_admin on thing for select using (has_role('admin'));
        create table bare (id uuid primary key);
        create table owner (id uuid primary key);
        alter table owner enable row level security;
      `,
    },
    {
      name: "0002_b.sql",
      text: `
        alter type kind add value if not exists 'c' after 'a';
        alter table thing add column note text, add column legacy int;
        alter table thing drop column legacy;
        alter table thing alter column note set not null;
        alter table thing add constraint thing_note_len check (char_length(note) < 10);
        drop policy if exists thing_select_admin on thing;
        create policy thing_all_admin on thing for all to app_authenticated using (has_role('admin')) with check (has_role('admin'));
        create view thing_view with (security_invoker = true) as select id from thing;
        create function guard() returns trigger language plpgsql security definer as $$ begin return new; end $$;
        create trigger guard_trg before update on thing for each row execute function guard();
        create index thing_idx on thing (owner_id);
        grant select on thing to anon;
      `,
    },
  ];
  const schema = parseMigrations(files);
  const thing = schema.tables.find((t) => t.name === "thing");

  it("bygger tabeller, kolonner og konstraints i filrækkefølge", () => {
    expect(thing?.columns.map((c) => c.name)).toEqual(["id", "kind", "owner_id", "note"]);
    expect(thing?.columns.find((c) => c.name === "note")?.notNull).toBe(true);
    expect(thing?.constraints.some((c) => c.startsWith("unique"))).toBe(true);
    expect(thing?.constraints.some((c) => c.includes("thing_note_len"))).toBe(true);
  });

  it("folder policies: drop fjerner, create tilføjer, kommando og roller udledes", () => {
    expect(thing?.policies.map((p) => p.name)).toEqual(["thing_select_owner", "thing_all_admin"]);
    expect(thing?.policies[1]).toMatchObject({
      command: "all",
      roles: "app_authenticated",
      using: "has_role('admin')",
      withCheck: "has_role('admin')",
    });
  });

  it("finder tabeller uden RLS — det fase 6.2 beder om at tjekke", () => {
    expect(schema.tables.filter((t) => !t.rls).map((t) => t.name)).toEqual(["bare"]);
    const md = renderSchema(schema, files.map((f) => f.name));
    expect(md).toContain("Tabeller uden `enable row level security`: `bare`");
    expect(md).toContain("RLS slået til men uden nogen policy");
  });

  it("udleder enum-værdier (med after), views, funktioner og triggere", () => {
    expect(schema.enums[0]?.values).toEqual(["a", "c", "b"]);
    expect(schema.views[0]).toMatchObject({ name: "thing_view", securityInvoker: true });
    expect(schema.functions[0]).toMatchObject({ name: "guard", securityDefiner: true });
    expect(schema.triggers[0]).toMatchObject({ name: "guard_trg", table: "thing" });
  });

  it("tæller det den ikke genkender i stedet for at gætte", () => {
    const odd = parseMigrations([
      { name: "0001.sql", text: "create table t (id int); alter table t cluster on t_idx; alter table missing add column x int;" },
    ]);
    expect(odd.unparsed.length).toBe(2);
    expect(renderSchema(odd, ["0001.sql"])).toContain("2 sætninger blev ikke genkendt");
  });
});

describe("parseEnvExample og renderEnv", () => {
  const text = `# ──────────────
# Overskrift
# ──────────────

# --- Sektion A (noget) ---
FLAG_X=
# En forklaring
# der fortsætter.
SECRET_Y=
NEXT_PUBLIC_Z=https://eksempel.dk

# --- Sektion B ---
# Alene
OTHER=1
`;
  const sections = parseEnvExample(text);

  it("henter sektioner, variabler, eksempelværdi og kommentaren umiddelbart over", () => {
    expect(sections.map((s) => s.title)).toEqual(["Sektion A (noget)", "Sektion B"]);
    expect(sections[0]?.variables.map((v) => v.name)).toEqual(["FLAG_X", "SECRET_Y", "NEXT_PUBLIC_Z"]);
    expect(sections[0]?.variables[1]?.description).toBe("En forklaring der fortsætter.");
    expect(sections[0]?.variables[2]?.example).toBe("https://eksempel.dk");
    expect(sections[1]?.variables[0]?.description).toBe("Alene");
  });

  it("renderer synlighed og launch-krav fra datafilen", () => {
    const requirements = launchRequirementsOf({
      generelleHemmeligheder: [{ label: "y", anyOf: ["SECRET_Y"], minLength: 32 }],
      porte: [],
      oevrigeFlag: [],
      beslutninger: [],
    });
    const md = renderEnv(sections, requirements);
    expect(md).toContain("| `NEXT_PUBLIC_Z` | offentlig |");
    expect(md).toContain("| `SECRET_Y` | server | platform (mindst 32 tegn) |");
    expect(requirements.get("FLAG_DEMO")).toBe("skal være slukket");
  });
});
