import { describe, expect, it } from "vitest";

import {
  buildLaunchReport,
  checkAdrIndex,
  checkKey,
  countStubRegisterRows,
  countTodoMarkers,
  derivePortMode,
  evaluateEnv,
  parseOpenBacklog,
  renderMarkdown,
  renderText,
  tableRows,
  type LaunchDataShape,
} from "../../scripts/lib/launch-core.mjs";

/**
 * Go-live-kontrollens rene dele (ADR 0069). Hver regel testes på en streng — ingen filer, ingen
 * process.env — så de kan stole på uden at køre kommandoen mod repoet.
 */

const PORT = {
  key: "booking",
  realAdapterBuilt: true,
  demoAdapterBuilt: true,
  factoryKeys: [{ label: "Cal.com API-nøgle", anyOf: ["CALCOM_API_KEY"] }],
  otherKeys: [{ label: "Webhook", anyOf: ["CALCOM_WEBHOOK_SECRET"] }],
  accepted: null,
};

const DATA: LaunchDataShape = {
  generelleHemmeligheder: [
    { label: "Cron", anyOf: ["CRON_SECRET"] },
    { label: "Rating", anyOf: ["RATING_LINK_SECRET"], minLength: 32 },
  ],
  porte: [PORT],
  oevrigeFlag: [{ flag: "leadPartner", env: "FLAG_LEADPARTNER", intent: "slukket", note: "" }],
  beslutninger: [
    { id: "a", owner: "ejer", blocksLaunch: true, title: "Åben", consequence: "x", source: "s", parked: null },
    { id: "b", owner: "mads", blocksLaunch: false, title: "Parkeret", consequence: "x", source: "s", parked: { by: "Andreas", date: "2026-10-12" } },
  ],
};

const GOOD_ENV = {
  FLAG_BOOKING: "true",
  CALCOM_API_KEY: "k",
  CALCOM_WEBHOOK_SECRET: "w",
  CRON_SECRET: "c",
  RATING_LINK_SECRET: "x".repeat(32),
};

describe("checkKey", () => {
  it("skelner sat, mangler og for kort — og returnerer aldrig værdien", () => {
    const requirement = { label: "r", anyOf: ["RATING_LINK_SECRET"], minLength: 32 };
    expect(checkKey({}, requirement).state).toBe("mangler");
    expect(checkKey({ RATING_LINK_SECRET: "   " }, requirement).state).toBe("mangler");
    expect(checkKey({ RATING_LINK_SECRET: "kort" }, requirement).state).toBe("for-kort");
    const ok = checkKey({ RATING_LINK_SECRET: "y".repeat(40) }, requirement);
    expect(ok.state).toBe("sat");
    expect(JSON.stringify(ok)).not.toContain("yyyy");
  });

  it("accepterer den første sat mulighed af flere", () => {
    const requirement = { label: "r", anyOf: ["LLM_API_KEY", "ORDBOGEN_API_KEY"] };
    expect(checkKey({ ORDBOGEN_API_KEY: "k" }, requirement).state).toBe("sat");
  });
});

describe("derivePortMode", () => {
  it("følger factorierne: rigtig kræver flag + nøgler + bygget adapter, demo kun uden nøgler", () => {
    expect(derivePortMode(DATA, PORT, GOOD_ENV)).toBe("real");
    expect(derivePortMode(DATA, PORT, { CALCOM_API_KEY: "k" })).toBe("stub");
    expect(derivePortMode(DATA, PORT, { FLAG_DEMO: "true" })).toBe("demo");
    // Rigtige nøgler vinder over demo — men uden flag er det en stub, ikke demo.
    expect(derivePortMode(DATA, PORT, { FLAG_DEMO: "true", CALCOM_API_KEY: "k" })).toBe("stub");
    expect(derivePortMode(DATA, { ...PORT, realAdapterBuilt: false }, GOOD_ENV)).toBe("stub");
  });
});

describe("evaluateEnv", () => {
  it("er klar når alt er sat og intet er demo", () => {
    const result = evaluateEnv(DATA, GOOD_ENV);
    expect(result.blockers).toEqual([]);
    expect(result.ports[0]?.verdict).toBe("klar");
  });

  it("blokerer på FLAG_DEMO", () => {
    const result = evaluateEnv(DATA, { ...GOOD_ENV, FLAG_DEMO: "true" });
    expect(result.demoOn).toBe(true);
    expect(result.blockers.map((b) => b.area)).toContain("demo");
  });

  it("blokerer på manglende og for korte hemmeligheder", () => {
    const result = evaluateEnv(DATA, { ...GOOD_ENV, CRON_SECRET: "", RATING_LINK_SECRET: "kort" });
    const messages = result.blockers.map((b) => b.message).join("\n");
    expect(messages).toContain("CRON_SECRET mangler");
    expect(messages).toContain("RATING_LINK_SECRET er for kort");
  });

  it("blokerer på en stub uden accept, men ikke på en bevidst accepteret stub (og dens nøgler er ikke et krav)", () => {
    const open = evaluateEnv(DATA, { CRON_SECRET: "c", RATING_LINK_SECRET: "x".repeat(32) });
    expect(open.ports[0]?.verdict).toBe("blokerer");

    const accepted: LaunchDataShape = {
      ...DATA,
      porte: [{ ...PORT, accepted: { by: "Andreas", date: "2026-10-12" } }],
    };
    const result = evaluateEnv(accepted, { CRON_SECRET: "c", RATING_LINK_SECRET: "x".repeat(32) });
    expect(result.ports[0]?.verdict).toBe("klar");
    expect(result.blockers).toEqual([]);
  });

  it("blokerer på en rigtig port uden webhook-hemmelighed", () => {
    const { CALCOM_WEBHOOK_SECRET: _omit, ...env } = GOOD_ENV;
    const result = evaluateEnv(DATA, env);
    expect(result.ports[0]?.verdict).toBe("blokerer");
    expect(result.blockers.some((b) => b.message.includes("CALCOM_WEBHOOK_SECRET"))).toBe(true);
  });

  it("blokerer når et flag afviger fra det dokumenterede, og når det ikke er dokumenteret", () => {
    const on = evaluateEnv(DATA, { ...GOOD_ENV, FLAG_LEADPARTNER: "true" });
    expect(on.flags[0]?.verdict).toBe("blokerer");

    const undocumented = { ...DATA, oevrigeFlag: [{ flag: "leadPartner", env: "FLAG_LEADPARTNER", intent: null, note: "" }] };
    const result = evaluateEnv(undocumented as LaunchDataShape, GOOD_ENV);
    expect(result.flags[0]?.reason).toContain("ikke dokumenteret");
  });

  it("flager en delvist konfigureret adgangsport (den er ellers stille inaktiv)", () => {
    const result = evaluateEnv(DATA, { ...GOOD_ENV, APP_GATE_ENABLED: "true" });
    expect(result.gate).toEqual({ active: false, partial: true });
    expect(result.blockers.map((b) => b.area)).toContain("adgangsport");
    const active = evaluateEnv(DATA, {
      ...GOOD_ENV,
      APP_GATE_ENABLED: "true",
      APP_GATE_PASSWORD_HASH: "h",
      APP_GATE_COOKIE_SECRET: "s",
    });
    expect(active.gate.active).toBe(true);
    expect(active.blockers).toEqual([]);
  });
});

describe("countTodoMarkers", () => {
  it("tæller ejer- og Mads-markører pr. fil og sorterer efter antal", () => {
    const a = "TODO" + "(ejer)";
    const m = "TODO" + "(mads)";
    const result = countTodoMarkers([
      { path: "src/a.ts", text: `// ${a}: x\n// ${a}: y\n// ${m}: z` },
      { path: "src/b.ts", text: `// ${m}: z` },
      { path: "src/c.ts", text: "// TODO: ingen ejer" },
    ]);
    expect(result).toMatchObject({ ejer: 2, mads: 2, total: 4 });
    expect(result.files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

const REGISTER = `# Stub-register

## Backend-stubs — kaster

| Modul | Flag |
|---|---|
| a | x |
| ~~b~~ | lukket |
| c | y |

## Demo-implementeringer (ADR 0041) — ikke huller

| Modul | demo |
|---|---|
| booking | ja |

## Beslutnings-pladsholdere

| Sted | Pladsholder |
|---|---|
| d | z |

## Bevidst tomme — ikke stubs

- Adgangsporten
`;

describe("countStubRegisterRows", () => {
  it("tæller åbne rækker, ikke overstregede, demo eller bevidst tomme", () => {
    const result = countStubRegisterRows(REGISTER);
    expect(result.total).toBe(3);
    expect(result.perSection).toEqual({
      "Backend-stubs — kaster": 2,
      "Beslutnings-pladsholdere": 1,
    });
  });

  it("returnerer nul for et tomt register", () => {
    expect(countStubRegisterRows("# Tomt\n\n## Backend-stubs\n\n| A | B |\n|---|---|\n").total).toBe(0);
  });
});

describe("tableRows", () => {
  it("tæller rækker som en tom linje har brudt fra deres tabel", () => {
    const md = "## S\n\n| ID | Punkt |\n|---|---|\n| **B-1** | a |\n\n| **B-2** | b |\n";
    expect(tableRows(md).map((r) => r.cells[0])).toEqual(["**B-1**", "**B-2**"]);
  });
});

describe("parseOpenBacklog", () => {
  it("returnerer åbne B-numre og ignorerer lukkede og afgrænsningstabellen", () => {
    const md = `## Hvad hører til her

| Spores | Hvor |
|---|---|
| Aktive stubs | stub-register |

## 1. Nu

| ID | Punkt |
|---|---|
| **B-22** | a |

| **B-27** | b |

## Lukkede punkter

| ID | Punkt |
|---|---|
| B-01 | lukket |
`;
    expect(parseOpenBacklog(md)).toEqual(["B-22", "B-27"]);
  });
});

describe("checkAdrIndex", () => {
  const index = `| # | Titel |
|---|---|
| 0000 | Skabelon |
| 0001 | Første |
| 0002 | Anden |
| 0003 | Tredje |
| 0004 | *(nummer reserveret til en skive, ikke brugt)* |
| 0005 | Femte |
`;

  it("er hul-fri når filer og indekslinjer matcher, og reserverede numre tæller ikke", () => {
    const result = checkAdrIndex(index, [
      "0000-template.md",
      "0001-a.md",
      "0002-b.md",
      "0003-c.md",
      "0005-e.md",
      "README.md",
    ]);
    expect(result).toMatchObject({
      reserved: ["0004"],
      filesWithoutIndexLine: [],
      indexLinesWithoutFile: [],
      sequenceGaps: [],
    });
  });

  it("finder en fil uden indekslinje, en indekslinje uden fil og et nummer der mangler helt", () => {
    const result = checkAdrIndex(index, ["0000-t.md", "0001-a.md", "0003-c.md", "0005-e.md", "0006-f.md"]);
    expect(result.filesWithoutIndexLine).toEqual(["0006"]);
    expect(result.indexLinesWithoutFile).toEqual(["0002"]);
    expect(result.sequenceGaps).toEqual([]);

    const gap = checkAdrIndex("| 0001 | a |\n| 0004 | d |\n", ["0001-a.md", "0004-d.md"]);
    expect(gap.sequenceGaps).toEqual(["0002", "0003"]);
  });
});

describe("buildLaunchReport og rendering", () => {
  const emptyRepo = {
    todo: { ejer: 0, mads: 0, total: 0, files: [] },
    stubRegister: { total: 0, perSection: {} },
    backlog: [],
    adr: {
      files: 2,
      indexLines: 2,
      reserved: [],
      filesWithoutIndexLine: [],
      indexLinesWithoutFile: [],
      sequenceGaps: [],
    },
  };
  const closed: LaunchDataShape = { ...DATA, beslutninger: [] };

  it("er klar kun når intet blokerer", () => {
    const report = buildLaunchReport({ data: closed, env: GOOD_ENV, ...emptyRepo });
    expect(report.ready).toBe(true);
    expect(renderText(report)).toContain("KLAR");
  });

  it("samler blokeringer på tværs af miljø og repo", () => {
    const report = buildLaunchReport({
      data: DATA,
      env: {},
      todo: { ejer: 1, mads: 1, total: 2, files: [{ path: "src/x.ts", ejer: 1, mads: 1 }] },
      stubRegister: { total: 3, perSection: { A: 3 } },
      backlog: ["B-1"],
      adr: { ...emptyRepo.adr, filesWithoutIndexLine: ["0003"] },
    });
    expect(report.ready).toBe(false);
    const areas = new Set(report.blockers.map((b) => b.area));
    for (const area of ["porte", "hemmeligheder", "beslutninger", "todo", "stub-register", "backlog", "adr"]) {
      expect(areas.has(area), area).toBe(true);
    }
    expect(renderText(report)).toContain("BLOKERET");
  });

  it("kan springe miljøet over", () => {
    const report = buildLaunchReport({ data: closed, env: {}, skipEnv: true, ...emptyRepo });
    expect(report.env).toBeNull();
    expect(report.ready).toBe(true);
  });

  it("markdown-rapporten er deterministisk og indeholder aldrig en værdi fra miljøet", () => {
    const env = { ...GOOD_ENV, CRON_SECRET: "hemmelig-vaerdi-123" };
    const report = buildLaunchReport({ data: DATA, env, ...emptyRepo });
    const markdown = renderMarkdown(report);
    expect(markdown).toBe(renderMarkdown(report));
    expect(markdown).toContain("# Go-live-kontrol");
    expect(markdown).not.toContain("hemmelig-vaerdi-123");
  });
});
