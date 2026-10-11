/** Typer for `reference-core.mjs`. */

import type { LaunchDataShape } from "./launch-core.mjs";

export interface Access {
  kind: string;
  label: string;
  certain: boolean;
}

export interface PageRoute {
  route: string;
  file: string;
  access: Access;
}

export interface HandlerRoute extends PageRoute {
  methods: string[];
}

export interface GateRule {
  matcher: string | null;
  exact: string[];
  prefixes: string[];
  stateOf(path: string): string;
}

export interface ScheduledFunction {
  name: string;
  file: string;
  schedule: string | null;
  calls: string | null;
}

export interface SchemaColumn {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  primaryKey: boolean;
  unique: boolean;
  references: { table: string; column: string | null; onDelete: string | null } | null;
  check: string | null;
}

export interface SchemaPolicy {
  name: string;
  command: string;
  roles: string | null;
  using: string | null;
  withCheck: string | null;
  createdIn: string;
}

export interface SchemaTable {
  name: string;
  createdIn: string;
  columns: SchemaColumn[];
  constraints: string[];
  rls: boolean;
  policies: SchemaPolicy[];
}

export interface Schema {
  tables: SchemaTable[];
  enums: Array<{ name: string; createdIn: string; values: string[] }>;
  views: Array<{ name: string; createdIn: string; securityInvoker: boolean }>;
  functions: Array<{ name: string; createdIn: string; args: string; returns: string | null; securityDefiner: boolean }>;
  triggers: Array<{ name: string; when: string; table: string; createdIn: string }>;
  unparsed: string[];
}

export interface EnvSection {
  title: string;
  variables: Array<{ name: string; example: string; description: string }>;
}

export function routePathOf(file: string): string;
export function classifyHandler(path: string, text: string): Access & { kind: string };
export function classifyPage(path: string, text: string, layoutTexts?: string[]): Access;
export function gateRule(proxyText: string, gateText: string): GateRule;
export function parseScheduled(files: Array<{ path: string; text: string }>): ScheduledFunction[];
export function deriveRoutes(files: Array<{ path: string; text: string }>): {
  pages: PageRoute[];
  handlers: HandlerRoute[];
};
export function renderRoutes(
  routes: { pages: PageRoute[]; handlers: HandlerRoute[] },
  scheduled: ScheduledFunction[],
  gate: GateRule,
): string;
export function splitStatements(sql: string): string[];
export function splitTopLevel(text: string): string[];
export function parseColumn(item: string): SchemaColumn | null;
export function parseMigrations(files: Array<{ name: string; text: string }>): Schema;
export function renderSchema(schema: Schema, migrationNames: readonly string[]): string;
export function parseEnvExample(text: string): EnvSection[];
export function renderEnv(sections: EnvSection[], launchRequirements: Map<string, string>): string;
export function launchRequirementsOf(data: LaunchDataShape): Map<string, string>;
