"use server";

/**
 * Ejer-mutationer for medlemskab (Fase 3, ADR 0028). Service-role bag requireRole('ejer') +
 * eksplicit ejerskabstjek (service-role bypasser RLS). Op-/nedgradering er RENE
 * Supabase-operationer — intet abonnement hos betalingsleverandøren at opdatere (ADR 0029);
 * ny frekvens/boardstørrelse slår igennem ved næste afholdelse (ingen proratering, §5.9).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { createPaymentProvider } from "@/lib/payments";
import { getCurrentUser, requireRole, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";

const VALID_FREQUENCIES = new Set([4, 8, 12]);

async function requireOwnerContext(): Promise<{ service: SupabaseClient; user: AuthUser }> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "ejer");
  return { service: createServiceSupabase(config), user };
}

async function requireOwnedBoard(service: SupabaseClient, user: AuthUser, boardId: string): Promise<void> {
  const { data } = await service
    .from("board")
    .select("id")
    .eq("id", boardId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) throw new Error("Board ikke fundet.");
}

/** Slå membership op og verificér ejerskab via board. PostgREST to-one-embed normaliseres. */
async function findOwnedMembership(
  service: SupabaseClient,
  user: AuthUser,
  membershipId: string,
): Promise<boolean> {
  const { data } = await service
    .from("membership")
    .select("id, board(owner_id)")
    .eq("id", membershipId)
    .maybeSingle();
  if (!data) return false;
  const row = data as unknown as { board: { owner_id: string } | Array<{ owner_id: string }> | null };
  const board = Array.isArray(row.board) ? row.board[0] : row.board;
  return Boolean(board && board.owner_id === user.id);
}

/** Opret medlemskab for ejerens board med valgt frekvens (fra formularen; quiz-svaret er prefill). */
export async function createMembership(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  try {
    const { service, user } = await requireOwnerContext();
    const boardId = String(formData.get("board_id") ?? "");
    const frequency = Number(formData.get("frequency_weeks"));
    if (!boardId || !VALID_FREQUENCIES.has(frequency)) {
      return { error: "Board og gyldig frekvens (4/8/12 uger) er påkrævet." };
    }
    await requireOwnedBoard(service, user, boardId);

    const { data, error } = await service
      .from("membership")
      .upsert({ board_id: boardId, frequency_weeks: frequency }, { onConflict: "board_id" })
      .select("id")
      .single();
    if (error || !data) {
      return { error: `Kunne ikke oprette medlemskab: ${error?.message ?? "ingen række skrevet"}` };
    }
    revalidatePath("/betaling");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Skift frekvens (op-/nedgradering). Ny pris gælder fra næste afholdte møde. */
export async function setMembershipFrequency(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireOwnerContext();
    const membershipId = String(formData.get("membership_id") ?? "");
    const frequency = Number(formData.get("frequency_weeks"));
    if (!membershipId || !VALID_FREQUENCIES.has(frequency)) {
      return { error: "Medlemskab og gyldig frekvens er påkrævet." };
    }

    if (!(await findOwnedMembership(service, user, membershipId))) {
      return { error: "Medlemskab ikke fundet." };
    }

    const { error } = await service
      .from("membership")
      .update({ frequency_weeks: frequency, updated_at: new Date().toISOString() })
      .eq("id", membershipId);
    if (error) return { error: `Kunne ikke skifte frekvens: ${error.message}` };

    revalidatePath("/betaling");
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Registrér betalingskort via porten. Med stub aktiv (ingen Alunta-nøgler) kaster den
 * NotConfiguredError — ejeren ser den ærlige besked; intet foregives (stub-politik).
 */
export async function registerCard(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  let checkoutUrl: string | null = null;
  try {
    const { service, user } = await requireOwnerContext();
    const membershipId = String(formData.get("membership_id") ?? "");
    if (!membershipId) return { error: "Medlemskab er påkrævet." };

    if (!(await findOwnedMembership(service, user, membershipId))) {
      return { error: "Medlemskab ikke fundet." };
    }

    // Membership-id sendes som external_customer_id (ADR 0030); checkout.completed-webhooken
    // kobler Aluntas customer-uuid på og flipper card_status — intet sættes optimistisk her.
    const session = await createPaymentProvider().registerCard({ customerRef: membershipId });

    revalidatePath("/betaling");
    checkoutUrl = session.url || null;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  // redirect kaster NEXT_REDIRECT — skal ske UDEN FOR try/catch, ellers fanges den som fejl.
  if (checkoutUrl) redirect(checkoutUrl);
  return {};
}
