import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Farvekontrast mod tokens (fase 6.2, ADR 0070). axe kan ikke måle kontrast i jsdom (intet
 * layout), så vi regner WCAG 2.x direkte på `src/styles/design-tokens.css` — den autoritative
 * kilde. To lister:
 *  - SKAL BESTÅ: kombinationer appen bruger til brødtekst og UI, og som opfylder AA (4,5:1 for
 *    tekst, 3:1 for ikke-tekst og stor tekst).
 *  - KENDTE HUL: brandfarven guld på lyse flader m.fl. Det er et DESIGNvalg, ikke Claude Codes
 *    (CLAUDE.md): guld er manualens accent. Hullerne er registreret i docs/backlog.md (B-80)
 *    med en foreslået mørkere tekst-variant til Mads. Testen låser de målte tal fast, så en
 *    ændring af en token ikke sker ubemærket — og den fejler den dag hullet er lukket, så
 *    listen og backloggen holdes ærlige.
 */
const TOKENS = readFileSync(join(process.cwd(), "src/styles/design-tokens.css"), "utf8");

function token(name: string): string {
  const match = TOKENS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`token --${name} findes ikke som hex i design-tokens.css`);
  return match[1];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast-hjælperen", () => {
  it("sort på hvid er 21:1 og samme farve er 1:1 (WCAG-referenceværdier)", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("kontrast mod tokens — skal bestå WCAG AA", () => {
  const passes: Array<[string, string, string, number]> = [
    ["brødtekst på hvid", "color-text", "color-white", 4.5],
    ["sekundær tekst på hvid", "color-text-muted", "color-white", 4.5],
    ["sekundær tekst på lysegrå", "color-text-muted", "color-grey-bg", 4.5],
    ["navy overskrift på hvid", "color-navy", "color-white", 4.5],
    ["navy tekst på lysegrå", "color-navy", "color-grey-bg", 4.5],
    ["charcoal på hvid", "color-charcoal", "color-white", 4.5],
    ["hvid på navy-bånd", "color-white", "color-navy", 4.5],
    ["hvid på charcoal-bånd", "color-white", "color-charcoal", 4.5],
    ["guld eyebrow på charcoal", "color-gold", "color-charcoal", 4.5],
    ["tekstlink på hvid", "color-link", "color-white", 4.5],
    ["slate felt-kant mod hvid (ikke-tekst, 3:1)", "color-slate", "color-white", 3],
    ["navy fokusring mod hvid (ikke-tekst, 3:1)", "color-navy", "color-white", 3],
    ["hvid fokusring mod navy (ikke-tekst, 3:1)", "color-white", "color-navy", 3],
    ["hvid fokusring mod charcoal (ikke-tekst, 3:1)", "color-white", "color-charcoal", 3],
  ];

  it.each(passes)("%s", (_label, fg, bg, min) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });
});

describe("kendte kontrasthul (B-80) — målt og registreret, ikke ændret", () => {
  // [beskrivelse, forgrund, baggrund, forventet afrundet forhold]
  const gaps: Array<[string, string, string, number]> = [
    ["guld tekst på hvid (eyebrows, tekstlinks)", "color-gold", "color-white", 2.81],
    ["hvid tekst på guld-CTA", "color-white", "color-gold", 2.81],
    ["guld tekst på lysegrå", "color-gold", "color-grey-bg", 2.43],
    ["guld tekst på navy (eyebrow i navy-bånd)", "color-gold", "color-navy", 4.25],
    ["hvid tekst på guld-CTA ved hover", "color-white", "color-gold-dark", 3.49],
    ["stålblå tekst på hvid", "color-steel", "color-white", 4.09],
    ["slate som TEKST på hvid (kun kanter må bruge den)", "color-slate", "color-white", 3.99],
  ];

  it.each(gaps)("%s", (_label, fg, bg, expected) => {
    const ratio = contrast(token(fg), token(bg));
    expect(Math.round(ratio * 100) / 100).toBe(expected);
    // Under AA for normal tekst — ellers er hullet lukket og rækken skal fjernes (og B-80 opdateres).
    expect(ratio).toBeLessThan(4.5);
  });
});

describe("kontrast i stylesheets", () => {
  const COMPONENTS = readFileSync(
    join(process.cwd(), "src/styles/components.css"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const GLOBALS = readFileSync(join(process.cwd(), "src/styles/globals.css"), "utf8");

  function rules(css: string): Array<{ selector: string; body: string }> {
    return [...css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: (m[1] as string).trim(),
      body: m[2] as string,
    }));
  }

  it("slate og stålblå bruges aldrig som tekstfarve (under 4,5:1) — kun til kanter og håndtag", () => {
    // .drag-handle er en grafisk kontrol (3:1-reglen for ikke-tekst), ikke løbende tekst.
    const allowed = new Set([".drag-handle"]);
    const offenders = rules(COMPONENTS)
      .filter((r) => /(^|[;\s])color:\s*var\(--color-(slate|steel)\)/.test(r.body))
      .map((r) => r.selector)
      .filter((selector) => !allowed.has(selector));
    expect(offenders).toEqual([]);
  });

  it("intet stylesheet fjerner fokusmarkeringen uden at erstatte den", () => {
    expect(COMPONENTS).not.toMatch(/outline:\s*(none|0)\b/);
    expect(GLOBALS).not.toMatch(/outline:\s*(none|0)\b/);
  });

  it("der er en global :focus-visible-regel i token-farver, og en hvid variant på mørke flader", () => {
    expect(GLOBALS).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-navy\)/);
    expect(GLOBALS).toMatch(/\.pagehead :focus-visible[^{]*\{[^}]*var\(--color-white\)/);
  });
});
