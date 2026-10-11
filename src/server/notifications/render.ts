/**
 * Skabelon-rendering (fase 4.5/4.6, ADR 0057). Ren og uden afhængigheder — den bruges både
 * af motoren (afsendelse) og af editorens live preview i browseren, så preview og udsendelse
 * aldrig kan komme til at betyde forskellige ting.
 *
 * Syntaksen er bevidst lille og eksplicit: `{{navn}}`, hvor navnet er små bogstaver, tal og
 * understreg og skal findes i beskedtypens variabelliste i kataloget. Der er ingen
 * betingelser, løkker eller udtryk — en skabelon er tekst med huller.
 *
 * Reglen der gør den sikker at udsende: en variabel der ikke findes, eller som mangler en
 * værdi, bliver ALDRIG et stille tomt felt. Den bliver et `problem`, og et resultat med
 * problemer er `ok: false` — motoren sender det ikke, og previewet markerer stedet.
 */

export type TemplateChannel = "email" | "sms";

export interface TemplateContent {
  channel: TemplateChannel;
  /** Kun e-mail. */
  subject: string | null;
  body: string;
}

export type TemplateField = "subject" | "body";

/** Et stykke af en renderet tekst — så previewet kan markere hver slags for sig. */
export type Segment =
  | { kind: "text"; text: string }
  /** En variabel der er erstattet med sin værdi. */
  | { kind: "value"; name: string; text: string }
  /** `{{navn}}` hvor navnet ikke er i beskedtypens variabelliste. */
  | { kind: "unknown"; name: string; raw: string }
  /** Kendt variabel, men koden/eksemplet leverede ingen værdi. */
  | { kind: "missing"; name: string; raw: string }
  /** `{{` eller `}}` der ikke er en gyldig variabel, fx `{{Ejer Navn}}` eller en uafsluttet `{{`. */
  | { kind: "invalid"; raw: string };

export type ProblemKind = "unknown" | "missing" | "syntax";

export interface TemplateProblem {
  kind: ProblemKind;
  field: TemplateField;
  /** Variabelnavnet, når problemet handler om en bestemt variabel. */
  name?: string;
  message: string;
}

export interface RenderResult {
  /** Sand når der ingen problemer er — kun så må resultatet sendes. */
  ok: boolean;
  /** Emnelinjen som ren tekst (linjeskift i værdier fjernet). `null` for SMS. */
  subject: string | null;
  /** Brødtekst som ren tekst — e-mailens tekstdel og hele SMS'en. */
  text: string;
  /** Brødtekst som HTML — alle værdier og al tekst escapet. `null` for SMS. */
  html: string | null;
  segments: { subject: Segment[] | null; body: Segment[] };
  problems: TemplateProblem[];
}

export type VariableValues = Readonly<Record<string, string | undefined>>;

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Flere end to klammer i hver ende (`{{{x}}}`) fanges med og afvises som syntaksfejl nedenfor.
const MARKER = /\{\{+([^{}]*)\}\}+/g;

type Token =
  | { kind: "text"; value: string }
  | { kind: "variable"; name: string; raw: string }
  | { kind: "invalid"; raw: string };

/** Del en skabelon i tekst, variabler og ugyldige `{{ }}`-rester. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;

  const pushText = (value: string) => {
    if (!value) return;
    // Rester af klammer uden for en gyldig markør er syntaksfejl, ikke tekst.
    const parts = value.split(/(\{\{|\}\})/);
    for (const part of parts) {
      if (part === "{{" || part === "}}") tokens.push({ kind: "invalid", raw: part });
      else if (part) tokens.push({ kind: "text", value: part });
    }
  };

  for (const match of source.matchAll(MARKER)) {
    const index = match.index ?? 0;
    pushText(source.slice(last, index));
    const inner = (match[1] ?? "").trim();
    const exact = match[0].startsWith("{{") && !match[0].startsWith("{{{") && !match[0].endsWith("}}}");
    if (exact && NAME.test(inner)) tokens.push({ kind: "variable", name: inner, raw: match[0] });
    else tokens.push({ kind: "invalid", raw: match[0] });
    last = index + match[0].length;
  }
  pushText(source.slice(last));
  return tokens;
}

function segmentsFor(
  source: string,
  field: TemplateField,
  variables: VariableValues,
  allowed: ReadonlySet<string>,
  problems: TemplateProblem[],
): Segment[] {
  return tokenize(source).map((token): Segment => {
    if (token.kind === "text") return { kind: "text", text: token.value };

    if (token.kind === "invalid") {
      problems.push({
        kind: "syntax",
        field,
        message: `«${token.raw}» er ikke en gyldig variabel. Skriv {{navn}} med små bogstaver, tal og understreg.`,
      });
      return { kind: "invalid", raw: token.raw };
    }

    if (!allowed.has(token.name)) {
      problems.push({
        kind: "unknown",
        field,
        name: token.name,
        message: `Variablen «${token.name}» findes ikke for denne beskedtype.`,
      });
      return { kind: "unknown", name: token.name, raw: token.raw };
    }

    const value = variables[token.name];
    if (value === undefined) {
      problems.push({
        kind: "missing",
        field,
        name: token.name,
        message: `Variablen «${token.name}» har ingen værdi.`,
      });
      return { kind: "missing", name: token.name, raw: token.raw };
    }
    return { kind: "value", name: token.name, text: value };
  });
}

function segmentText(segments: readonly Segment[]): string {
  // Problemsteder står som deres rå `{{…}}` — synlige, aldrig tomme.
  return segments
    .map((segment) =>
      segment.kind === "text" || segment.kind === "value" ? segment.text : segment.raw,
    )
    .join("");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Gør http(s)-adresser i ALLEREDE escapet tekst klikbare. `&amp;` er korrekt i en href. */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    // Afsluttende tegnsætning hører til sætningen, ikke adressen.
    const trailing = /[.,;:!?)]+$/.exec(url)?.[0] ?? "";
    const clean = trailing ? url.slice(0, -trailing.length) : url;
    return `<a href="${clean}">${clean}</a>${trailing}`;
  });
}

/** Brødtekst → HTML: alt escapes, blanke linjer bliver afsnit, enkelte linjeskift `<br>`. */
function toHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${linkify(escapeHtml(paragraph)).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html lang="da"><body>${paragraphs.join("")}</body></html>`;
}

/**
 * Render en skabelon med de givne værdier.
 *
 * - `allowed` er beskedtypens variabelnøgler fra kataloget. Alt andet er `unknown`.
 * - `variables` leverer værdierne. En kendt variabel uden værdi er `missing` — en eksplicit
 *   tom streng er en værdi (afsenderen har valgt "ingenting"), `undefined` er ikke.
 * - Værdier substitueres én gang og fortolkes aldrig igen: en værdi der indeholder `{{x}}`
 *   forbliver tekst.
 * - Emnelinjer får linjeskift i værdier erstattet med mellemrum (header-injektion).
 */
export function renderTemplate(
  template: TemplateContent,
  variables: VariableValues,
  allowed: readonly string[],
): RenderResult {
  const allowedSet = new Set(allowed);
  const problems: TemplateProblem[] = [];

  const subjectSegments =
    template.channel === "email" && template.subject !== null
      ? segmentsFor(template.subject, "subject", variables, allowedSet, problems).map(
          (segment): Segment =>
            segment.kind === "value"
              ? { ...segment, text: segment.text.replace(/[\r\n]+/g, " ") }
              : segment,
        )
      : null;
  const bodySegments = segmentsFor(template.body, "body", variables, allowedSet, problems);

  const text = segmentText(bodySegments).replace(/\r\n?/g, "\n");
  return {
    ok: problems.length === 0,
    subject: subjectSegments ? segmentText(subjectSegments) : null,
    text,
    html: template.channel === "email" ? toHtml(text) : null,
    segments: { subject: subjectSegments, body: bodySegments },
    problems,
  };
}

/**
 * Valider en skabelons TEKST uden værdier: kun syntaks og ukendte variabler tæller (manglende
 * værdier er et spørgsmål om afsenderen, ikke om teksten). Bruges ved gem/publicér.
 */
export function validateTemplate(
  template: TemplateContent,
  allowed: readonly string[],
): TemplateProblem[] {
  const everything = Object.fromEntries(allowed.map((key) => [key, ""]));
  return renderTemplate(template, everything, allowed).problems;
}

/** Variabler en tekst bruger — i rækkefølge, uden dubletter. Til editorens oversigt. */
export function usedVariables(source: string): string[] {
  const seen = new Set<string>();
  for (const token of tokenize(source)) {
    if (token.kind === "variable") seen.add(token.name);
  }
  return [...seen];
}
