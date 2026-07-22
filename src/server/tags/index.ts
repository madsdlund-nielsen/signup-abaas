/**
 * Business-data-access for kompetence-tags (Fase 1-fundament). Etablerer det genbrugelige
 * mønster for forretningsdata: LÆSNING sker via den authed server-klient (RLS-håndhævet), så
 * kun det brugeren må se returneres. SKRIVNING (admin) ligger i ./actions bag service-role +
 * requireRole('admin'). Se ADR 0016.
 *
 * Uden Supabase-konfiguration (kontofri CI/dev) returneres en tom liste — siderne rendrer stadig.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export { slugify } from "./slug";

export interface CompetenceTag {
  id: string;
  slug: string;
  label: string;
  sortOrder: number;
}

interface TagRow {
  id: string;
  slug: string;
  label: string;
  sort_order: number;
}

function rowToTag(row: TagRow): CompetenceTag {
  return { id: row.id, slug: row.slug, label: row.label, sortOrder: row.sort_order };
}

export async function listTags(
  env: Record<string, string | undefined> = process.env,
): Promise<CompetenceTag[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("competence_tag")
    .select("id, slug, label, sort_order")
    .order("sort_order");

  if (error) {
    console.error(`[tags] listTags fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as TagRow[]).map(rowToTag);
}
