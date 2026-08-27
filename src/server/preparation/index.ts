/**
 * Business-data-access for mødeforberedelse (Fase 4.1, ADR 0038). Læsning via den authed
 * server-klient — RLS afgør synligheden (0015), så de SAMME funktioner virker for ejer,
 * partner og admin uden rolle-forgreninger her. Writes ligger i ./actions (service-role bag
 * rolle- + ejerskabstjek). Ukonfigureret Supabase → tom/null, som resten af src/server.
 *
 * Bemærk asymmetrien, den er tilsigtet: dagsordenen er DELT (partneren skal kunne forberede
 * sig på den), forberedelsesnoten er PRIVAT for sin forfatter. Begge dele håndhæves af RLS,
 * ikke her — denne fil ville se ens ud uanset.
 */

import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServerSupabase } from "@/server/auth/supabase-server";

export type AgendaItemKind = "dagsorden" | "spoergsmaal" | "materiale";

export interface AgendaItem {
  id: string;
  meetingId: string;
  kind: AgendaItemKind;
  body: string;
  sortOrder: number;
}

export interface PrepNote {
  id: string;
  meetingId: string;
  partnerProfileId: string;
  body: string;
  updatedAt: string;
}

interface AgendaItemRow {
  id: string;
  meeting_id: string;
  kind: AgendaItemKind;
  body: string;
  sort_order: number;
}

interface PrepNoteRow {
  id: string;
  meeting_id: string;
  partner_profile_id: string;
  body: string;
  updated_at: string;
}

const AGENDA_COLUMNS = "id, meeting_id, kind, body, sort_order";
const PREP_NOTE_COLUMNS = "id, meeting_id, partner_profile_id, body, updated_at";

/** Dansk etiket pr. type — ét sted, så UI'et ikke opfinder sine egne. */
export const AGENDA_KIND_LABEL: Record<AgendaItemKind, string> = {
  dagsorden: "Dagsordenspunkt",
  spoergsmaal: "Spørgsmål til boardet",
  materiale: "Materiale",
};

function rowToAgendaItem(row: AgendaItemRow): AgendaItem {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind,
    body: row.body,
    sortOrder: row.sort_order,
  };
}

/**
 * Dagsordenen for ét møde. Synlig for boardets ejer, boardets partnere og admin (0015).
 * Ser en bruger uden adgang på den, returnerer RLS 0 rækker — ikke en fejl.
 */
export async function listAgendaItems(
  meetingId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<AgendaItem[]> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return [];

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("meeting_agenda_item")
    .select(AGENDA_COLUMNS)
    .eq("meeting_id", meetingId)
    .order("kind", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) {
    console.error(`[preparation] listAgendaItems fejlede: ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as AgendaItemRow[]).map(rowToAgendaItem);
}

/**
 * Den forberedelsesnote den nuværende bruger selv har skrevet på et møde. Ingen
 * partner-id-parameter: RLS tillader kun forfatteren (og admin) at se rækken, så et
 * eksplicit filter ville kun gentage det autorisationslaget allerede gør.
 */
export async function getMyPrepNote(
  meetingId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<PrepNote | null> {
  const config = readSupabaseAuthConfig(env);
  if (!isSupabaseAuthConfigured(config)) return null;

  const supabase = await createServerSupabase(config);
  const { data, error } = await supabase
    .from("meeting_prep_note")
    .select(PREP_NOTE_COLUMNS)
    .eq("meeting_id", meetingId)
    .maybeSingle();
  if (error) {
    console.error(`[preparation] getMyPrepNote fejlede: ${error.message}`);
    return null;
  }
  if (!data) return null;

  const row = data as unknown as PrepNoteRow;
  return {
    id: row.id,
    meetingId: row.meeting_id,
    partnerProfileId: row.partner_profile_id,
    body: row.body,
    updatedAt: row.updated_at,
  };
}
