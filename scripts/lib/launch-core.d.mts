/** Typer for `launch-core.mjs`, så testene kan importere den uden `any`. */

export type Env = Record<string, string | undefined>;

export interface KeyRequirement {
  label: string;
  anyOf: readonly string[];
  minLength?: number;
}

export interface KeyStatus {
  label: string;
  envNames: readonly string[];
  state: "sat" | "mangler" | "for-kort";
}

export interface LaunchPort {
  key: string;
  realAdapterBuilt: boolean;
  demoAdapterBuilt: boolean;
  factoryKeys: readonly KeyRequirement[];
  otherKeys: readonly KeyRequirement[];
  accepted: { by: string; date: string; note?: string } | null;
}

export interface LaunchDataShape {
  generelleHemmeligheder: readonly KeyRequirement[];
  porte: readonly LaunchPort[];
  oevrigeFlag: ReadonlyArray<{ flag: string; env: string; intent: "tændt" | "slukket" | null; note: string }>;
  beslutninger: ReadonlyArray<{
    id: string;
    owner: "ejer" | "mads";
    blocksLaunch: boolean;
    title: string;
    consequence: string;
    source: string;
    parked: { by: string; date: string } | null;
  }>;
}

export interface Blocker {
  area: string;
  message: string;
}

export interface EnvResult {
  demoOn: boolean;
  ports: Array<{
    key: string;
    mode: "real" | "demo" | "stub";
    verdict: "klar" | "blokerer";
    reason: string;
    factory: KeyStatus[];
    other: KeyStatus[];
  }>;
  secrets: KeyStatus[];
  flags: Array<{ flag: string; enabled: boolean; verdict: "klar" | "blokerer"; reason: string }>;
  gate: { active: boolean; partial: boolean };
  blockers: Blocker[];
}

export interface TodoCount {
  ejer: number;
  mads: number;
  total: number;
  files: Array<{ path: string; ejer: number; mads: number }>;
}

export interface StubRegisterCount {
  total: number;
  perSection: Record<string, number>;
}

export interface AdrCheck {
  files: number;
  indexLines: number;
  reserved: string[];
  filesWithoutIndexLine: string[];
  indexLinesWithoutFile: string[];
  sequenceGaps: string[];
}

export interface LaunchReport {
  env: EnvResult | null;
  decisions: LaunchDataShape["beslutninger"][number][];
  todo: TodoCount;
  stubRegister: StubRegisterCount;
  backlog: string[];
  adr: AdrCheck;
  blockers: Blocker[];
  ready: boolean;
}

export const PORT_FLAG: Record<string, string>;
export function flagIsOn(env: Env, name: string): boolean;
export function checkKey(env: Env, requirement: KeyRequirement): KeyStatus;
export function derivePortMode(data: LaunchDataShape, port: LaunchPort, env: Env): "real" | "demo" | "stub";
export function evaluateEnv(data: LaunchDataShape, env: Env): EnvResult;
export function openDecisions(data: LaunchDataShape): LaunchDataShape["beslutninger"];
export function countTodoMarkers(files: Array<{ path: string; text: string }>): TodoCount;
export function tableRows(markdown: string): Array<{ section: string; cells: string[] }>;
export function countStubRegisterRows(markdown: string): StubRegisterCount;
export function parseOpenBacklog(markdown: string): string[];
export function checkAdrIndex(indexMarkdown: string, fileNames: readonly string[]): AdrCheck;
export function buildLaunchReport(input: {
  data: LaunchDataShape;
  env: Env;
  skipEnv?: boolean;
  todo: TodoCount;
  stubRegister: StubRegisterCount;
  backlog: string[];
  adr: AdrCheck;
}): LaunchReport;
export function renderText(report: LaunchReport): string;
export function renderMarkdown(report: LaunchReport): string;
