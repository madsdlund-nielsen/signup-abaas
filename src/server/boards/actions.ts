"use server";

/**
 * Ejer-mutationer for boardet (Fase 1.5, ADR 0021/0022). Writes går via service-role bag
 * requireRole('ejer') med .select()-verify-readback — samme mønster som partner-/quiz-actions.
 *
 * VIGTIGT: service-role bypasser RLS, så ejerskab verificeres EKSPLICIT her (board.owner_id mod den
 * nuværende bruger). Uden det ville en ejer kunne mutere et fremmed board via et gættet board-id.
 *
 * Invarianterne (byggespec §3/§5.6 "altid mindst 1 intern partner", §5.2 2-3 partnere) og de
 * skrivende trin bor i ./composition og deles med admins vej (./admin-actions, ADR 0062) — her er
 * kun auth, ejerskab og navigation. Efter hver ændring opdateres boardets Cal.com-hosts og
 * ændringen logges; en Cal.com-fejl vises ikke for ejeren (hun kan intet stille op med den) men
 * står på admins revisionsspor, som viser at hosts hænger efter.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCurrentUser, requireRole, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { isEnabled } from "@/server/flags";
import { applyBoardChange, assertBoardShape, readInternalFlags, type BoardChange } from "./composition";

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

/** Ejerskabstjek + den fælles ændring (invarianter, hosts, log). */
async function changeOwnBoard(context: OwnerContext, boardId: string, change: BoardChange): Promise<void> {
  await requireOwnedBoard(context, boardId);
  await applyBoardChange(context.service, { id: context.user.id, role: "ejer" }, boardId, change);
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
  const internalById = await readInternalFlags(context.service, partnerIds);
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

  // Mister boardet sin lead ved udskiftningen, går den til den indkommende hvis hun er intern,
  // ellers den første interne (./composition). TODO(ejer): lead-partner regler.
  await changeOwnBoard(context, boardId, { kind: "udskift", outgoingId, incomingId });

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

  await changeOwnBoard(context, boardId, { kind: "saet_lead", partnerId });

  revalidatePath("/board");
}

/**
 * Op-/nedgradering af boardstørrelse (Fase 3, ADR 0030): tilføj/fjern én partner med
 * fase 1-invarianten håndhævet (2-3 partnere, mindst 1 intern). Prisen følger automatisk —
 * abonnementet beregnes af boardstørrelsen ved næste faktureringsperiode (ingen proratering, ADR 0056).
 */
export async function addBoardPartner(formData: FormData): Promise<void> {
  const context = await requireOwnerContext();
  const boardId = String(formData.get("board_id") ?? "");
  const partnerId = String(formData.get("partner") ?? "");
  if (!boardId || !partnerId) throw new Error("Board og partner er påkrævet.");

  await changeOwnBoard(context, boardId, { kind: "tilfoej", partnerId });

  revalidatePath("/board");
  revalidatePath("/betaling");
}

export async function removeBoardPartner(formData: FormData): Promise<void> {
  const context = await requireOwnerContext();
  const boardId = String(formData.get("board_id") ?? "");
  const partnerId = String(formData.get("partner") ?? "");
  if (!boardId || !partnerId) throw new Error("Board og partner er påkrævet.");

  // Fjernede vi lead'en, udpeges den første interne igen (samme pladsholder som ved
  // oprettelse/udskift). TODO(ejer): lead-partner regler.
  await changeOwnBoard(context, boardId, { kind: "fjern", partnerId });

  revalidatePath("/board");
  revalidatePath("/betaling");
}
