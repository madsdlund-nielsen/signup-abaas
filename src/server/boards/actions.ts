"use server";

/**
 * Ejer-mutationer for boardet (Fase 1.5, ADR 0021/0022). Writes går via service-role bag
 * requireRole('ejer') med .select()-verify-readback — samme mønster som partner-/quiz-actions.
 *
 * VIGTIGT: service-role bypasser RLS, så ejerskab verificeres EKSPLICIT her (board.owner_id mod den
 * nuværende bruger). Uden det ville en ejer kunne mutere et fremmed board via et gættet board-id.
 *
 * Byggespec §3/§5.6 ("altid mindst 1 intern partner", "flag valideret ved board-oprettelse") og §5.2
 * (2-3 partnere) håndhæves her — de er invarianter på tværs af rækker og hører derfor til ved
 * board-oprettelse, ikke som DB-constraint.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentUser, requireRole, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { isEnabled } from "@/server/flags";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "@/server/matching/algorithm";

interface OwnerContext {
  service: SupabaseClient;
  user: AuthUser;
}

async function requireOwnerContext(): Promise<OwnerContext> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "ejer");
  return { service: createServiceSupabase(config), user };
}

/** Verificér at boardet findes OG tilhører den nuværende ejer (service-role bypasser RLS). */
async function requireOwnedBoard(context: OwnerContext, boardId: string): Promise<void> {
  const { data, error } = await context.service
    .from("board")
    .select("id")
    .eq("id", boardId)
    .eq("owner_id", context.user.id)
    .maybeSingle();
  if (error || !data) throw new Error("Board ikke fundet.");
}

/** is_internal for et sæt katalogposter. Bruges til at håndhæve "mindst 1 intern". */
async function readInternalFlags(
  context: OwnerContext,
  partnerIds: string[],
): Promise<Map<string, boolean>> {
  const { data, error } = await context.service
    .from("partner_profile")
    .select("id, is_internal")
    .in("id", partnerIds);
  if (error) throw new Error(`Kunne ikke læse partner-profiler: ${error.message}`);

  const rows = (data ?? []) as Array<{ id: string; is_internal: boolean }>;
  if (rows.length !== partnerIds.length) throw new Error("Ukendt partner i boardet.");
  return new Map(rows.map((row) => [row.id, row.is_internal]));
}

function assertBoardShape(partnerIds: string[], internalById: Map<string, boolean>): void {
  if (partnerIds.length < MIN_BOARD_SIZE || partnerIds.length > MAX_BOARD_SIZE) {
    throw new Error(`Et board skal bestå af ${MIN_BOARD_SIZE}-${MAX_BOARD_SIZE} partnere.`);
  }
  if (!partnerIds.some((id) => internalById.get(id))) {
    throw new Error("Et board skal have mindst én intern partner.");
  }
}

function readPartnerIds(formData: FormData): string[] {
  return [
    ...new Set(
      formData
        .getAll("partner")
        .map((value) => String(value))
        .filter((value) => value.length > 0),
    ),
  ];
}

/**
 * Godkend det anbefalede board: opret board + medlemskaber.
 *
 * Lead sættes deterministisk på den første interne partner, så data altid er konsistente.
 * TODO(ejer): lead-partner regler — tildeling og rotation er uafklaret; den manuelle markering
 * ligger bag feature-flaget `leadPartner`, og denne default er en pladsholder, ikke en beslutning.
 */
export async function approveBoard(formData: FormData): Promise<void> {
  const context = await requireOwnerContext();
  const partnerIds = readPartnerIds(formData);
  const internalById = await readInternalFlags(context, partnerIds);
  assertBoardShape(partnerIds, internalById);

  const { data: board, error: boardError } = await context.service
    .from("board")
    .insert({ owner_id: context.user.id, name: "Mit board" })
    .select("id")
    .single();
  if (boardError || !board) {
    throw new Error(`Kunne ikke oprette board: ${boardError?.message ?? "ingen række skrevet"}`);
  }

  const leadId = partnerIds.find((id) => internalById.get(id));
  const { error: membersError } = await context.service.from("board_partner").insert(
    partnerIds.map((partnerId) => ({
      board_id: board.id,
      partner_id: partnerId,
      is_lead: partnerId === leadId,
    })),
  );
  if (membersError) {
    throw new Error(`Kunne ikke gemme board-medlemmer: ${membersError.message}`);
  }

  revalidatePath("/board");
  revalidatePath("/dashboard");
  redirect("/board");
}

/**
 * Udskift én partner på boardet (fase-1.md §1.5). Redirecter tilbage med hvem der blev skiftet ud,
 * så infobaren kan forklare hvilke kompetence-tags der udgår/tilkommer.
 */
export async function swapBoardPartner(formData: FormData): Promise<void> {
  const context = await requireOwnerContext();
  const boardId = String(formData.get("board_id") ?? "");
  const outgoingId = String(formData.get("outgoing") ?? "");
  const incomingId = String(formData.get("incoming") ?? "");
  if (!boardId || !outgoingId || !incomingId) throw new Error("Manglende felter til udskiftning.");
  if (outgoingId === incomingId) redirect("/board");

  await requireOwnedBoard(context, boardId);

  const { data: current, error: currentError } = await context.service
    .from("board_partner")
    .select("partner_id, is_lead")
    .eq("board_id", boardId);
  if (currentError) throw new Error(`Kunne ikke læse boardet: ${currentError.message}`);

  const rows = (current ?? []) as Array<{ partner_id: string; is_lead: boolean }>;
  const outgoing = rows.find((row) => row.partner_id === outgoingId);
  if (!outgoing) throw new Error("Partneren sidder ikke på boardet.");
  if (rows.some((row) => row.partner_id === incomingId)) {
    throw new Error("Partneren sidder allerede på boardet.");
  }

  const nextIds = rows.map((row) => (row.partner_id === outgoingId ? incomingId : row.partner_id));
  const internalById = await readInternalFlags(context, nextIds);
  assertBoardShape(nextIds, internalById);

  const { error: deleteError } = await context.service
    .from("board_partner")
    .delete()
    .eq("board_id", boardId)
    .eq("partner_id", outgoingId);
  if (deleteError) throw new Error(`Kunne ikke fjerne partneren: ${deleteError.message}`);

  // Mister boardet sin lead ved udskiftningen, udpeges den første interne igen (samme pladsholder
  // som ved oprettelse). TODO(ejer): lead-partner regler.
  const keepsLead = rows.some((row) => row.is_lead && row.partner_id !== outgoingId);
  const { data: inserted, error: insertError } = await context.service
    .from("board_partner")
    .insert({
      board_id: boardId,
      partner_id: incomingId,
      is_lead: !keepsLead && (internalById.get(incomingId) ?? false),
    })
    .select("partner_id")
    .single();
  if (insertError || !inserted) {
    throw new Error(`Kunne ikke indsætte partneren: ${insertError?.message ?? "ingen række skrevet"}`);
  }

  if (!keepsLead && !internalById.get(incomingId)) {
    const fallbackLead = nextIds.find((id) => internalById.get(id));
    if (fallbackLead) {
      await context.service
        .from("board_partner")
        .update({ is_lead: true })
        .eq("board_id", boardId)
        .eq("partner_id", fallbackLead);
    }
  }

  revalidatePath("/board");
  redirect(`/board?udskiftet=${outgoingId}&til=${incomingId}`);
}

/**
 * Manuel udpegning af lead-partner. Bag feature-flaget `leadPartner`, fordi tildelings- og
 * rotationsregler er uafklarede (CLAUDE.md, byggespec §12 pkt. 15).
 * TODO(ejer): lead-partner regler.
 */
export async function setBoardLead(formData: FormData): Promise<void> {
  if (!isEnabled("leadPartner")) throw new Error("Lead-partner-markering er ikke slået til.");

  const context = await requireOwnerContext();
  const boardId = String(formData.get("board_id") ?? "");
  const partnerId = String(formData.get("partner") ?? "");
  if (!boardId || !partnerId) throw new Error("Manglende felter til lead-markering.");

  await requireOwnedBoard(context, boardId);

  const internalById = await readInternalFlags(context, [partnerId]);
  if (!internalById.get(partnerId)) {
    throw new Error("Kun en intern partner kan være lead.");
  }

  const { error: clearError } = await context.service
    .from("board_partner")
    .update({ is_lead: false })
    .eq("board_id", boardId);
  if (clearError) throw new Error(`Kunne ikke rydde lead: ${clearError.message}`);

  const { data, error } = await context.service
    .from("board_partner")
    .update({ is_lead: true })
    .eq("board_id", boardId)
    .eq("partner_id", partnerId)
    .select("partner_id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke sætte lead: ${error?.message ?? "ingen række ramt"}`);
  }

  revalidatePath("/board");
}

/**
 * Op-/nedgradering af boardstørrelse (Fase 3, ADR 0028): tilføj/fjern én partner med
 * fase 1-invarianten håndhævet (2-3 partnere, mindst 1 intern). Prisen følger automatisk —
 * meeting-fee beregnes af boardstørrelsen ved næste afholdelse (ingen proratering, §5.9).
 */
export async function addBoardPartner(formData: FormData): Promise<void> {
  const context = await requireOwnerContext();
  const boardId = String(formData.get("board_id") ?? "");
  const partnerId = String(formData.get("partner") ?? "");
  if (!boardId || !partnerId) throw new Error("Board og partner er påkrævet.");
  await requireOwnedBoard(context, boardId);

  const { data: current, error: currentError } = await context.service
    .from("board_partner")
    .select("partner_id")
    .eq("board_id", boardId);
  if (currentError) throw new Error(`Kunne ikke læse boardet: ${currentError.message}`);
  const currentIds = ((current ?? []) as Array<{ partner_id: string }>).map((r) => r.partner_id);
  if (currentIds.includes(partnerId)) throw new Error("Partneren sidder allerede på boardet.");

  const nextIds = [...currentIds, partnerId];
  const internalById = await readInternalFlags(context, nextIds);
  assertBoardShape(nextIds, internalById);

  const { data, error } = await context.service
    .from("board_partner")
    .insert({ board_id: boardId, partner_id: partnerId, is_lead: false })
    .select("partner_id")
    .single();
  if (error || !data) {
    throw new Error(`Kunne ikke tilføje partneren: ${error?.message ?? "ingen række skrevet"}`);
  }
  revalidatePath("/board");
  revalidatePath("/betaling");
}

export async function removeBoardPartner(formData: FormData): Promise<void> {
  const context = await requireOwnerContext();
  const boardId = String(formData.get("board_id") ?? "");
  const partnerId = String(formData.get("partner") ?? "");
  if (!boardId || !partnerId) throw new Error("Board og partner er påkrævet.");
  await requireOwnedBoard(context, boardId);

  const { data: current, error: currentError } = await context.service
    .from("board_partner")
    .select("partner_id, is_lead")
    .eq("board_id", boardId);
  if (currentError) throw new Error(`Kunne ikke læse boardet: ${currentError.message}`);
  const rows = (current ?? []) as Array<{ partner_id: string; is_lead: boolean }>;
  if (!rows.some((r) => r.partner_id === partnerId)) {
    throw new Error("Partneren sidder ikke på boardet.");
  }

  const nextIds = rows.map((r) => r.partner_id).filter((id) => id !== partnerId);
  const internalById = await readInternalFlags(context, nextIds);
  assertBoardShape(nextIds, internalById);

  const { error } = await context.service
    .from("board_partner")
    .delete()
    .eq("board_id", boardId)
    .eq("partner_id", partnerId);
  if (error) throw new Error(`Kunne ikke fjerne partneren: ${error.message}`);

  // Fjernede vi lead'en, udpeges den første interne igen (samme pladsholder som ved
  // oprettelse/udskift). TODO(ejer): lead-partner regler.
  const removedWasLead = rows.some((r) => r.partner_id === partnerId && r.is_lead);
  if (removedWasLead) {
    const fallbackLead = nextIds.find((id) => internalById.get(id));
    if (fallbackLead) {
      await context.service
        .from("board_partner")
        .update({ is_lead: true })
        .eq("board_id", boardId)
        .eq("partner_id", fallbackLead);
    }
  }
  revalidatePath("/board");
  revalidatePath("/betaling");
}
