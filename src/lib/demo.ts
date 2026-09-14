/**
 * Fælles hjælpere til demo-implementeringerne (ADR 0041).
 *
 * Demo er den tredje adapter-implementering ved siden af rigtig og stub: en dummy der
 * VIRKER, så rejsen kan klikkes igennem før leverandørnøglerne lander. To regler:
 *
 *   1. Demo vælges kun når den rigtige config mangler — rigtige nøgler vinder altid.
 *      Det håndhæves i hver factory (`src/lib/<modul>/index.ts`), ikke her.
 *   2. Alt demo returnerer er ÅBENLYST falsk. Referencer bærer præfikset `DEMO-`, tekster
 *      starter med `[DEMO]`. Ingen værdi må kunne forveksles med en beslutning eller en
 *      rigtig leverandør-reference (docs/stub-politik.md).
 *
 * Demo er permanent produktionskode, ikke stillads: den samme tilstand bruges til
 * salgsdemoer, partner-onboarding og designarbejde efter launch.
 */

/** Reference der ikke kan forveksles med en rigtig leverandør-reference. */
export function demoRef(kind: string): string {
  const suffix = globalThis.crypto.randomUUID().slice(0, 8).toUpperCase();
  return `DEMO-${kind.toUpperCase()}-${suffix}`;
}

/**
 * Appens eget demo-møderum — står i stedet for et Cal Video-link.
 * `ref` er mødets id (video-demoen) eller booking-uid'et (booking-demoen); siden slår op på begge.
 */
export function demoRoomPath(ref: string): string {
  return `/moeder/rum/${encodeURIComponent(ref)}`;
}

/** Appens egen demo-checkout — står i stedet for leverandørens hostede kortregistrering. */
export function demoCheckoutPath(membershipId: string): string {
  return `/betaling/demo-kort/${encodeURIComponent(membershipId)}`;
}

/** Fast præfiks for demo-tekster, så de aldrig kan læses som ægte indhold. */
export const DEMO_TEXT_PREFIX = "[DEMO]";
