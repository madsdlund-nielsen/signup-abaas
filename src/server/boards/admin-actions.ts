"use server";

/**
 * Admins mutationer for boardets sammensætning (ADR 0062): tilføj, fjern, udskift og sæt lead.
 * CLAUDE.md § Roller: "Admin — styrer … board-sammensætning". Rollen udledes af sessionen
 * (requireRole('admin')) og service-role tages først efter tjekket — aldrig fra input. Admin er
 * ikke ejer af boardet, så der er intet ejerskabstjek; til gengæld skal boardet findes.
 *
 * Invarianterne (2-3 partnere, mindst én intern, lead er intern, ingen dubletter) og de skrivende
 * trin er de SAMME som ejerens vej — de bor i ./composition. En afvist ændring skriver intet.
 * Efter en vellykket ændring opdateres boardets Cal.com-hosts; fejler det, ruller ændringen IKKE
 * tilbage, men svaret bærer en tydelig advarsel (og revisionssporet husker den).
 *
 * TODO(ejer): lead-partner regler — tildeling og rotation er uafklaret. Den manuelle markering
 * ligger, som på ejerens side, bag feature-flaget `leadPartner`.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { BoardActionState } from "@/components/BoardActionForm";
import { getCurrentUser, requireRole, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { isEnabled } from "@/server/flags";
import { applyBoardChange, HOSTS_WARNING, type BoardChange } from "./composition";

async function requireAdminContext(): Promise<{ service: SupabaseClient; user: AuthUser }> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "admin");
  return { service: createServiceSupabase(config), user };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

interface Prepared {
  change: BoardChange;
  done: string;
}

async function runAdminChange(
  formData: FormData,
  prepare: (formData: FormData) => Prepared,
): Promise<BoardActionState> {
  try {
    const { service, user } = await requireAdminContext();
    const boardId = field(formData, "board_id");
    if (!boardId) return { error: "Board-id er påkrævet." };

    const { data: board, error: boardError } = await service
      .from("board")
      .select("id")
      .eq("id", boardId)
      .maybeSingle();
    if (boardError || !board) return { error: "Board ikke fundet." };

    const { change, done } = prepare(formData);
    const { hosts } = await applyBoardChange(service, { id: user.id, role: "admin" }, boardId, change);

    revalidatePath("/admin/boards");
    revalidatePath(`/admin/boards/${boardId}`);
    // Ejerens egne flader følger sammensætningen (board, pris, dashboard).
    revalidatePath("/board");
    revalidatePath("/betaling");
    revalidatePath("/dashboard");

    return hosts.status === "fejlet"
      ? { notice: done, warning: `${HOSTS_WARNING} ${hosts.message}` }
      : { notice: done };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function required(formData: FormData, name: string, message: string): string {
  const value = field(formData, name);
  if (!value) throw new Error(message);
  return value;
}

/** Tilføj en partner til boardet (op til 3). Prisen følger boardstørrelsen ved næste periode. */
export async function adminAddBoardPartner(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  return runAdminChange(formData, (data) => ({
    change: { kind: "tilfoej", partnerId: required(data, "partner", "Vælg en partner at tilføje.") },
    done: "Partneren er tilføjet boardet.",
  }));
}

/** Fjern en partner. Fjernes lead'en, går markeringen til den første interne. */
export async function adminRemoveBoardPartner(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  return runAdminChange(formData, (data) => ({
    change: { kind: "fjern", partnerId: required(data, "partner", "Partner er påkrævet.") },
    done: "Partneren er fjernet fra boardet.",
  }));
}

/**
 * Udskift én partner med en anden. Lead'en går til den indkommende, hvis vedkommende er intern.
 *
 * Ved succes redirectes til boardet med `?skiftet=<ind>&fra=<ud>` (B-71): «Udskift X»-sektionen,
 * som formularen står i, findes kun mens X sidder på boardet — og forsvinder i samme øjeblik
 * skiftet lykkes, så formularens egen besked aldrig nåede at blive set. Statuslinjen bor i stedet
 * på siden. En Cal.com-advarsel overlever redirecten af sig selv: editoren viser den ud fra
 * revisionssporet (`hostsOutOfSync`), ikke ud fra formularens svar. `redirect` kaster, så den står
 * uden for runAdminChange's try/catch.
 */
export async function adminSwapBoardPartner(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  const result = await runAdminChange(formData, (data) => {
    const outgoingId = required(data, "outgoing", "Udgående partner er påkrævet.");
    const incomingId = required(data, "incoming", "Vælg en partner at udskifte med.");
    if (outgoingId === incomingId) throw new Error("Vælg en anden partner end den udgående.");
    return { change: { kind: "udskift", outgoingId, incomingId }, done: "Partneren er udskiftet." };
  });
  if (result.error) return result;

  const params = new URLSearchParams({ skiftet: field(formData, "incoming"), fra: field(formData, "outgoing") });
  redirect(`/admin/boards/${encodeURIComponent(field(formData, "board_id"))}?${params.toString()}`);
}

/** Udpeg lead-partner. Bag `leadPartner` (tildelingsregler uafklaret); kun en intern kan være lead. */
export async function adminSetBoardLead(
  _prev: BoardActionState,
  formData: FormData,
): Promise<BoardActionState> {
  if (!isEnabled("leadPartner")) return { error: "Lead-partner-markering er ikke slået til." };
  return runAdminChange(formData, (data) => ({
    change: { kind: "saet_lead", partnerId: required(data, "partner", "Partner er påkrævet.") },
    done: "Lead-partneren er sat.",
  }));
}
