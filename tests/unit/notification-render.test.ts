import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderTemplate,
  usedVariables,
  validateTemplate,
  type TemplateContent,
} from "@/server/notifications/render";

/**
 * Skabelon-rendering (fase 4.5/4.6, ADR 0057). Alle tekster og værdier er åbenlyst syntetiske —
 * der findes ingen rigtig skabelontekst i repoet (ADR 0048).
 */
const ALLOWED = ["board_navn", "moede_tidspunkt", "link"] as const;

function email(subject: string, body: string): TemplateContent {
  return { channel: "email", subject, body };
}
function sms(body: string): TemplateContent {
  return { channel: "sms", subject: null, body };
}

describe("renderTemplate — substitution", () => {
  it("fletter værdier ind i emne og tekst", () => {
    const result = renderTemplate(
      email("[DEMO] {{board_navn}}", "[DEMO] Møde {{moede_tidspunkt}}"),
      { board_navn: "Testboard", moede_tidspunkt: "i morgen" },
      ALLOWED,
    );
    expect(result.ok).toBe(true);
    expect(result.subject).toBe("[DEMO] Testboard");
    expect(result.text).toBe("[DEMO] Møde i morgen");
    expect(result.problems).toEqual([]);
  });

  it("tåler mellemrum i klammerne og gentagne variabler", () => {
    const result = renderTemplate(sms("{{ board_navn }} / {{board_navn}}"), { board_navn: "X" }, ALLOWED);
    expect(result.ok).toBe(true);
    expect(result.text).toBe("X / X");
  });

  it("SMS har hverken emne eller HTML", () => {
    const result = renderTemplate(sms("{{board_navn}}"), { board_navn: "X" }, ALLOWED);
    expect(result.subject).toBeNull();
    expect(result.html).toBeNull();
    expect(result.segments.subject).toBeNull();
  });

  it("fortolker aldrig en værdi igen — {{x}} i en værdi forbliver tekst", () => {
    const result = renderTemplate(
      sms("{{board_navn}}"),
      { board_navn: "{{link}}", link: "https://skjult.invalid" },
      ALLOWED,
    );
    expect(result.text).toBe("{{link}}");
    expect(result.ok).toBe(true);
  });

  it("en tom streng er en værdi (afsenderen har valgt «ingenting»)", () => {
    const result = renderTemplate(sms("[{{board_navn}}]"), { board_navn: "" }, ALLOWED);
    expect(result.ok).toBe(true);
    expect(result.text).toBe("[]");
  });

  it("fjerner linjeskift fra værdier i emnelinjen (header-injektion), men ikke i brødteksten", () => {
    const result = renderTemplate(
      email("Emne {{board_navn}}", "Tekst {{board_navn}}"),
      { board_navn: "A\r\nBcc: x@y.invalid" },
      ALLOWED,
    );
    expect(result.subject).toBe("Emne A Bcc: x@y.invalid");
    expect(result.subject).not.toMatch(/[\r\n]/);
    expect(result.text).toContain("\n");
  });
});

describe("renderTemplate — aldrig stille tomme felter", () => {
  it("en ukendt variabel er et problem, ikke en tom streng", () => {
    const result = renderTemplate(sms("Hej {{ejer_navn}}"), { ejer_navn: "Anna" }, ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.objectContaining({ kind: "unknown", name: "ejer_navn", field: "body" }),
    ]);
    // Stedet står synligt i teksten og som et markeret segment.
    expect(result.text).toBe("Hej {{ejer_navn}}");
    expect(result.segments.body).toContainEqual({ kind: "unknown", name: "ejer_navn", raw: "{{ejer_navn}}" });
  });

  it("en kendt variabel uden værdi er et problem (missing)", () => {
    const result = renderTemplate(sms("{{link}}"), {}, ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toMatchObject({ kind: "missing", name: "link" });
    expect(result.segments.body).toContainEqual({ kind: "missing", name: "link", raw: "{{link}}" });
  });

  it("en variabel med værdien undefined tæller som manglende", () => {
    const result = renderTemplate(sms("{{link}}"), { link: undefined }, ALLOWED);
    expect(result.problems[0]?.kind).toBe("missing");
  });

  it("problemer i emnelinjen peger på emnet", () => {
    const result = renderTemplate(email("{{ukendt}}", "tekst"), {}, ALLOWED);
    expect(result.problems[0]).toMatchObject({ kind: "unknown", field: "subject" });
  });

  it.each([
    ["Navn med mellemrum", "{{Ejer navn}}"],
    ["tom variabel", "{{}}"],
    ["uafsluttet", "Hej {{board_navn"],
    ["løs afslutning", "board_navn}}"],
    ["tredobbelt klamme", "{{{board_navn}}}"],
  ])("syntaksfejl (%s) er et problem", (_label, body) => {
    const result = renderTemplate(sms(body), { board_navn: "X" }, ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.kind === "syntax")).toBe(true);
  });

  it("en variabel med store bogstaver parses som variabel og er ukendt (aldrig stille rettet)", () => {
    const result = renderTemplate(sms("{{Board_Navn}}"), { board_navn: "X" }, ALLOWED);
    expect(result.problems[0]).toMatchObject({ kind: "unknown", name: "Board_Navn" });
  });
});

describe("renderTemplate — HTML-escaping", () => {
  it("escaper værdier i e-mailens HTML-del, men ikke i tekstdelen", () => {
    const result = renderTemplate(
      email("Emne", "Hej {{board_navn}}"),
      { board_navn: `<script>alert("x")</script> & 'y'` },
      ALLOWED,
    );
    expect(result.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
    expect(result.html).not.toContain("<script>");
    expect(result.text).toContain("<script>");
  });

  it("escaper også selve skabelonteksten (den er tekst, ikke HTML)", () => {
    const result = renderTemplate(email("Emne", "a <b>fed</b> c"), {}, ALLOWED);
    expect(result.html).toContain("a &lt;b&gt;fed&lt;/b&gt; c");
    expect(result.html).not.toContain("<b>");
  });

  it("blanke linjer bliver afsnit og enkelte linjeskift <br>", () => {
    const result = renderTemplate(email("Emne", "Linje ét\nLinje to\n\nAfsnit to"), {}, ALLOWED);
    expect(result.html).toContain("<p>Linje ét<br>Linje to</p><p>Afsnit to</p>");
  });

  it("gør adresser klikbare, uden at tegnsætning efter dem kommer med", () => {
    const result = renderTemplate(
      email("Emne", "Se {{link}}."),
      { link: "https://demo.invalid/moeder/DEMO-1?a=1&b=2" },
      ALLOWED,
    );
    expect(result.html).toContain(
      '<a href="https://demo.invalid/moeder/DEMO-1?a=1&amp;b=2">https://demo.invalid/moeder/DEMO-1?a=1&amp;b=2</a>.',
    );
  });

  it("en værdi kan ikke bryde ud af href'en", () => {
    const result = renderTemplate(
      email("Emne", "{{link}}"),
      { link: 'https://demo.invalid/"onmouseover="x' },
      ALLOWED,
    );
    expect(result.html).not.toMatch(/href="[^"]*"onmouseover/);
    expect(result.html).toContain("&quot;");
  });

  it("escapeHtml dækker de fem tegn", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("validateTemplate — kun teksten, ikke værdierne", () => {
  it("accepterer en tekst med tilladte variabler", () => {
    expect(validateTemplate(email("{{board_navn}}", "{{link}} {{moede_tidspunkt}}"), ALLOWED)).toEqual([]);
  });

  it("finder ukendte variabler og syntaksfejl i både emne og tekst", () => {
    const problems = validateTemplate(email("{{x}}", "{{Y Z}}"), ALLOWED);
    expect(problems.map((p) => [p.kind, p.field])).toEqual([
      ["unknown", "subject"],
      ["syntax", "body"],
    ]);
  });
});

describe("usedVariables", () => {
  it("giver variablerne i rækkefølge uden dubletter", () => {
    expect(usedVariables("{{b}} {{a}} {{b}} {{ c }}")).toEqual(["b", "a", "c"]);
  });
});
