import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Mailskabelonerne bag B-70 (ADR 0073). Den kanoniske kopi ligger i `supabase/templates/` (det Mads
 * indsætter i Supabase-dashboardet); e2e-stakken kan ikke følge et symlink ud af sit projekt, så
 * `tests/e2e/supabase/templates/` er en kopi. Denne test holder dem ens og linkene rigtige.
 */
const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe.each([
  ["invite", "invite"],
  ["recovery", "recovery"],
])("mailskabelon %s", (file, type) => {
  const canonical = read(`supabase/templates/${file}.html`);

  it("e2e-kopien er identisk med den kanoniske skabelon", () => {
    expect(read(`tests/e2e/supabase/templates/${file}.html`)).toBe(canonical);
  });

  it("peger på appens egen bekræftelsesrute med token_hash, ikke på Supabases verify-endpoint", () => {
    expect(canonical).toContain(
      `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}&next=/konto/adgangskode`,
    );
    expect(canonical).not.toContain("{{ .ConfirmationURL }}");
  });

  it("er på dansk og bruger ingen hardcodede farver eller inline-styles", () => {
    expect(canonical).toMatch(/adgangskode/i);
    expect(canonical).not.toMatch(/style=|#[0-9a-f]{3,6}\b/i);
  });
});

describe("e2e-stakkens konfiguration", () => {
  const config = read("tests/e2e/supabase/config.toml");

  it("bruger skabelonerne til invitation og nulstilling", () => {
    expect(config).toMatch(/\[auth\.email\.template\.invite\][^[]*content_path = "\.\/supabase\/templates\/invite\.html"/);
    expect(config).toMatch(/\[auth\.email\.template\.recovery\][^[]*content_path = "\.\/supabase\/templates\/recovery\.html"/);
  });
});
