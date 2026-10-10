/**
 * Læsning af skabeloner og udsendelseslog til admin (fase 4.6, ADR 0057). Via den authed klient:
 * RLS (0021) lader kun admin læse begge tabeller, så en side der ved en fejl nås af en ikke-admin
 * får tomme lister — ikke andres data. Writes ligger i `./template-actions`.
 * Ukonfigureret Supabase → [] (kontofri CI/dev).
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

import type { NotificationChannelKey } from "./catalog";
import type { DeliveryStatus } from "./store";
import type { TemplateStatus, TemplateVersion } from "./template-state";

export * from "./template-state";

interface TemplateRow {
  id: string;
  type_key: string;
  channel: NotificationChannelKey;
  version: number;
  status: TemplateStatus;
  subject: string | null;
  body: string;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const TEMPLATE_COLUMNS =
  "id, type_key, channel, version, status, subject, body, published_at, created_at, updated_at";

function rowToVersion(row: TemplateRow): TemplateVersion {
  return {
    id: row.id,
    typeKey: row.type_key,
    channel: row.channel,
    version: row.version,
    status: row.status,
    subject: row.subject,
    body: row.body,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Alle skabelonversioner (valgfrit for én type), nyeste først. */
export async function listTemplateVersions(
  typeKey?: string,
  env: Record<string, string | undefined> = process.env,
): Promise<TemplateVersion[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  let query = supabase.from("notification_template").select(TEMPLATE_COLUMNS);
  if (typeKey) query = query.eq("type_key", typeKey);
  const { data, error } = await query.order("version", { ascending: false });
  if (error) {
    console.error(`[notifications] listTemplateVersions fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as TemplateRow[]).map(rowToVersion);
}

/** En række i udsendelseslogget — uden modtageradresse; kun en bruger-reference. */
export interface DeliveryLogEntry {
  id: string;
  typeKey: string;
  channel: NotificationChannelKey;
  status: DeliveryStatus;
  attempt: number;
  error: string | null;
  templateVersion: number | null;
  createdAt: string;
}

interface DeliveryRow {
  id: string;
  type_key: string;
  channel: NotificationChannelKey;
  status: DeliveryStatus;
  attempt: number;
  error: string | null;
  created_at: string;
  notification_template: { version: number } | Array<{ version: number }> | null;
}

/** De seneste udsendelser, nyeste først (admin — RLS afgør). */
export async function listRecentDeliveries(
  limit = 20,
  env: Record<string, string | undefined> = process.env,
): Promise<DeliveryLogEntry[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("notification_delivery")
    .select("id, type_key, channel, status, attempt, error, created_at, notification_template(version)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`[notifications] listRecentDeliveries fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as DeliveryRow[]).map((row) => {
    const template = Array.isArray(row.notification_template)
      ? row.notification_template[0]
      : row.notification_template;
    return {
      id: row.id,
      typeKey: row.type_key,
      channel: row.channel,
      status: row.status,
      attempt: row.attempt,
      error: row.error,
      templateVersion: template?.version ?? null,
      createdAt: row.created_at,
    };
  });
}
