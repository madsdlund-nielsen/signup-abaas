/**
 * Samtykke til mødeoptagelse — fail-closed hul (fase 4.3/4.4, ADR 0058).
 *
 * 🔴 Samtykke til optagelse er ejerens punkt og må ALDRIG stubbes eller omgås
 * (CLAUDE.md, docs/stub-politik.md). Der findes endnu ingen mekanisme: ingen tabel, ingen
 * UI, ingen tilbagekaldelse, ingen samtykketekst. Derfor svarer denne funktion altid `null`
 * ("ikke registreret"), og alt der afhænger af den — transskription, og dermed AI-resumé
 * af rigtig lyd — afvises (`RecordingConsentMissingError`). Det er et synligt hul, ikke et
 * gæt: ingen kodesti kan komme forbi ved at tro at der er samtykke.
 *
 * Når ejeren har besluttet formen (hvem giver samtykke — ejer, partnere, alle deltagere?
 * pr. møde eller pr. board? hvordan tilbagekaldes det?), erstattes kroppen af et opslag i en
 * tabel med RLS (ADR 0007). Signaturen er den samme før og efter.
 *
 * TODO(ejer): samtykke til mødeoptagelse — mekanisme, tekst og tilbagekaldelse.
 */

import type { RecordingConsent } from "@/lib/transcription";

export async function getRecordingConsent(_meetingId: string): Promise<RecordingConsent | null> {
  return null;
}
