/**
 * Mødeoptagelsen (lyden) som transskriptionen skal bruge — hul indtil Cal.com-optagelse er
 * verificeret (spike L-8: findes native optagelse på Teams-planen, og hvordan hentes den?).
 *
 * Kaldes KUN efter at grundlaget (kontrakten, ADR 0065) er fastslået (`getRecordingConsent`) —
 * lyden hentes aldrig for et møde der ikke findes på platformen. Svarer `null` ("ingen optagelse"), som adapteren afviser højlydt
 * (`MissingRecordingError`) frem for at transskribere intet.
 *
 * TODO(mads): hent optagelsen fra Cal.com/Cal Video når L-8 er afklaret (docs/spikes/multi-host.md).
 */

import type { AudioPayload } from "@/lib/transcription";

export async function loadMeetingRecording(_meetingId: string): Promise<AudioPayload | null> {
  return null;
}
