/**
 * Feature-flags (fase 0, arbejdspakke 0.3 / Trin 6).
 *
 * Simpelt, env-baseret flag-system der kan skjule hele moduler uden redeploy.
 * Alle integrationsflag er OFF som standard i fase 0 — sub-processorer aktiveres
 * først når accounts/nøgler lander, og en åben spike/leverandørbeslutning er
 * afklaret. Et flag slås til med env-variablen `FLAG_<NAVN>=true`.
 *
 * Designet er bevidst minimalt nu; et DB-backed lag (pr. tenant/board) kan
 * lægges ovenpå senere uden at ændre kaldssitet. Se docs/adr/0005-*.md.
 */

export type FeatureFlag =
  | "booking"
  | "video"
  | "payments"
  | "accounting"
  | "aiFollowup"
  | "transcription"
  | "email"
  | "sms"
  | "analytics"
  | "inAppMessaging";

export const ALL_FLAGS: readonly FeatureFlag[] = [
  "booking",
  "video",
  "payments",
  "accounting",
  "aiFollowup",
  "transcription",
  "email",
  "sms",
  "analytics",
  "inAppMessaging",
] as const;

const TRUTHY = new Set(["1", "true", "on", "yes"]);

function envKey(flag: FeatureFlag): string {
  return `FLAG_${flag.toUpperCase()}`;
}

/**
 * Er et modul slået til? Læser `FLAG_<NAVN>` fra env.
 */
export function isEnabled(flag: FeatureFlag, env: Record<string, string | undefined> = process.env): boolean {
  // in-app messaging: hele modulet er uafklaret og holdes mørklagt uanset env.
  // TODO(ejer): in-app messaging — modulbeslutning mangler (CLAUDE.md, uafklarede punkter).
  if (flag === "inAppMessaging") return false;

  const raw = env[envKey(flag)];
  return raw != null && TRUTHY.has(raw.trim().toLowerCase());
}
