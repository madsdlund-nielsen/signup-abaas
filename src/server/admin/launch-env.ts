/**
 * Go-live-tjeklistens rene kerne (fase 6.4, ADR 0069): datafilen og de regler der læser den.
 *
 * Intet her rører Supabase, adaptere eller `process.env` som skjult input: miljøet er altid et
 * argument. Det er det der gør tjeklisten testbar — og det der lader `scripts/launch-check.mjs`
 * spejle den uden at importere TypeScript (paritetstest: `tests/integration/launch-parity.test.ts`).
 *
 * Tjeklisten læser KUN tilstedeværelse. Ingen funktion her returnerer en værdi eller en længde
 * af en hemmelighed — kun «sat», «mangler» eller «for kort».
 */

import raw from "./launch-data.json";

export type Env = Record<string, string | undefined>;

/** Et krav til en nøgle: mindst én af `anyOf` skal være sat (evt. med en mindstelængde). */
export interface KeyRequirement {
  label: string;
  anyOf: readonly string[];
  /** Mindste længde for at nøglen tæller som sat. Vises aldrig — kun «for kort». */
  minLength?: number;
}

export interface GeneralSecret extends KeyRequirement {
  formaal: string;
}

export interface PortLaunchData {
  key: string;
  /** Findes der en rigtig adapter i koden? Ellers forbliver porten stub, uanset nøgler. */
  realAdapterBuilt: boolean;
  /** Findes der en demo-implementering (ADR 0041)? Analytics har ingen. */
  demoAdapterBuilt: boolean;
  /** Nøglerne selve adapter-factoryen læser. Paritetstesten holder dem ærlige mod factoryen. */
  factoryKeys: readonly KeyRequirement[];
  /** Øvrige hemmeligheder porten kræver (webhook-signatur, team-id) som factoryen ikke læser. */
  otherKeys: readonly KeyRequirement[];
  /** Er det accepteret af ansvarlig at porten går i launch som stub? Ellers `null` = ikke accepteret. */
  accepted: { by: string; date: string; note?: string } | null;
}

export type FlagIntent = "tændt" | "slukket";

export interface OtherFlagLaunchData {
  flag: string;
  env: string;
  intent: FlagIntent | null;
  note: string;
}

export interface LaunchDecision {
  id: string;
  owner: "ejer" | "mads";
  /** Peger fase 6 eller CLAUDE.md eksplicit på at punktet blokerer selve launchen? */
  blocksLaunch: boolean;
  title: string;
  consequence: string;
  source: string;
  parked: { by: string; date: string } | null;
}

export interface LaunchData {
  generelleHemmeligheder: readonly GeneralSecret[];
  porte: readonly PortLaunchData[];
  oevrigeFlag: readonly OtherFlagLaunchData[];
  beslutninger: readonly LaunchDecision[];
}

export const LAUNCH_DATA: LaunchData = raw as unknown as LaunchData;

const TRUTHY = new Set(["1", "true", "on", "yes"]);

/** Samme læsning som feature-flag-systemet (`src/server/flags`), uden at afhænge af det. */
export function flagIsOn(env: Env, name: string): boolean {
  const value = env[name];
  return value != null && TRUTHY.has(value.trim().toLowerCase());
}

export type KeyState = "sat" | "mangler" | "for-kort";

export interface KeyStatus {
  label: string;
  /** Miljøvariablerne kravet kan opfyldes af — navne, aldrig værdier. */
  envNames: readonly string[];
  state: KeyState;
}

/** Tilstedeværelse af ét krav. Returnerer aldrig værdien eller dens længde. */
export function checkKey(env: Env, requirement: KeyRequirement): KeyStatus {
  let state: KeyState = "mangler";
  for (const name of requirement.anyOf) {
    const value = env[name]?.trim() ?? "";
    if (value === "") continue;
    if (requirement.minLength !== undefined && value.length < requirement.minLength) {
      // For kort tæller kun hvis ingen anden mulighed er sat korrekt.
      if (state === "mangler") state = "for-kort";
      continue;
    }
    state = "sat";
    break;
  }
  return { label: requirement.label, envNames: requirement.anyOf, state };
}

export function checkGeneralSecrets(env: Env, data: LaunchData = LAUNCH_DATA): KeyStatus[] {
  return data.generelleHemmeligheder.map((secret) => checkKey(env, secret));
}

export interface PortKeyStatus {
  portKey: string;
  factory: KeyStatus[];
  other: KeyStatus[];
  /** Alle nøgler (factory + øvrige) er sat. */
  complete: boolean;
}

export function checkPortKeys(env: Env, port: PortLaunchData): PortKeyStatus {
  const factory = port.factoryKeys.map((key) => checkKey(env, key));
  const other = port.otherKeys.map((key) => checkKey(env, key));
  return {
    portKey: port.key,
    factory,
    other,
    complete: [...factory, ...other].every((key) => key.state === "sat"),
  };
}

export function findPort(portKey: string, data: LaunchData = LAUNCH_DATA): PortLaunchData | undefined {
  return data.porte.find((port) => port.key === portKey);
}

export function openDecisions(data: LaunchData = LAUNCH_DATA): LaunchDecision[] {
  return data.beslutninger.filter((decision) => decision.parked === null);
}

export function parkedDecisions(data: LaunchData = LAUNCH_DATA): LaunchDecision[] {
  return data.beslutninger.filter((decision) => decision.parked !== null);
}
