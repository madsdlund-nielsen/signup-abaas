/**
 * Eksempelværdier til editorens live preview (fase 4.6). Rene demo-data: hver værdi er
 * åbenlyst falsk (`[DEMO]`, reserveret `.invalid`-domæne) og bruges kun til at vise admin
 * hvordan en skabelon kommer til at se ud. De sendes aldrig til nogen og indgår aldrig i en
 * udsendelse — motoren bygger sine værdier ud fra det faktiske møde.
 *
 * Nøglerne følger variablerne i `catalog.ts`; en variabel uden eksempel står i previewet som
 * manglende værdi (markeret), ikke som en opfundet.
 */

import { DEMO_TEXT_PREFIX } from "@/lib/demo";

export const PREVIEW_EXAMPLES: Readonly<Record<string, string>> = {
  modtager_navn: `${DEMO_TEXT_PREFIX} Eksempel Modtager`,
  board_navn: `${DEMO_TEXT_PREFIX} Eksempel-board`,
  moede_tidspunkt: `${DEMO_TEXT_PREFIX} 1. januar 2000 kl. 00.00`,
  aendring: `${DEMO_TEXT_PREFIX} flyttet`,
  link: "https://demo.invalid/moeder/DEMO-0000",
};
