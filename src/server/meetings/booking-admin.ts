"use server";

/**
 * Admin-handlinger til Cal.com-koblingen (ADR 0046, B-23): partner ↔ Cal.com-bruger (Teams-sæde)
 * og boardets collective event type. Writes via service-role bag requireRole('admin') med
 * .select()-readback — samme mønster som partner-/quiz-actions. Der findes ingen write-policies
 * på hverken `board` eller `partner_profile` (0019), så ejer/partner kan ikke nå kolonnerne.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, requireRole, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { recordBoardChange } from "@/server/boards/audit";
import { syncBoardHosts } from "./board-hosts";

async function requireAdminContext(): Promise<{ service: SupabaseClient; user: AuthUser }> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = requireRole(await getCurrentUser(), "admin");
  return { service: createServiceSupabase(config), user };
}

function toError(e: unknown): AuthFormState {
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Tom streng → null (fjern koblingen); ellers et positivt heltal (Cal.com-id'er er heltal). */
function parseCalcomId(raw: FormDataEntryValue | null, label: string): number | null {
  const text = String(raw ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} skal være et positivt heltal.`);
  return n;
}

/** Postgres unique_violation → dansk besked (to partnere kan ikke dele et Cal.com-sæde). */
function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/** Admin kobler en katalogpartner til sit Cal.com-sæde (tom = fjern koblingen). */
export async function setPartnerCalcomUserId(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service } = await requireAdminContext();
    const partnerId = String(formData.get("partner_id") ?? "");
    if (!partnerId) return { error: "Partner-id er påkrævet." };
    const calcomUserId = parseCalcomId(formData.get("calcom_user_id"), "Cal.com-bruger-id");

    const { data, error } = await service
      .from("partner_profile")
      .update({ calcom_user_id: calcomUserId, updated_at: new Date().toISOString() })
      .eq("id", partnerId)
      .select("id")
      .maybeSingle();
    if (isUniqueViolation(error)) {
      return { error: "Et andet katalogmedlem er allerede koblet til det Cal.com-bruger-id." };
    }
    if (error || !data) {
      return { error: `Kunne ikke gemme Cal.com-bruger: ${error?.message ?? "partner ikke fundet"}` };
    }
    revalidatePath(`/admin/partners/${partnerId}`);
    revalidatePath("/admin/boards");
    return {};
  } catch (e) {
    return toError(e);
  }
}

/**
 * Admin opretter (eller genskriver hosts på) boardets collective event type hos Cal.com og
 * gemmer id'et på boardet. Selve arbejdet ligger i `syncBoardHosts` (./board-hosts), som også kører
 * automatisk efter en sammensætningsændring (ADR 0062) — her er det knappen "Opret/Opdatér", der
 * bruges første gang og når den automatiske opdatering fejlede. Idempotent: eksisterende id →
 * opdatér. Resultatet logges på boardets revisionsspor, så en fejlet automatisk opdatering
 * ophæves af en vellykket manuel.
 */
export async function createBoardEventType(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireAdminContext();
    const boardId = String(formData.get("board_id") ?? "");
    if (!boardId) return { error: "Board-id er påkrævet." };

    const result = await syncBoardHosts(service, boardId, { createIfMissing: true });
    if (result.status === "sprunget_over") {
      // Kun demo når hertil (createIfMissing udelukker "ikke koblet"): intet er oprettet eller gemt.
      return {
        error:
          "[DEMO] Demo-tilstand: der er ikke oprettet noget event type hos Cal.com, og det falske id er " +
          "ikke gemt. Boardet bookes med et falsk demo-id.",
      };
    }

    await recordBoardChange(service, {
      boardId,
      actor: { id: user.id, role: "admin" },
      action: "opdater_hosts",
      calcomSync: result.status,
    });
    if (result.status === "fejlet") return { error: result.message };

    revalidatePath("/admin/boards");
    revalidatePath(`/admin/boards/${boardId}`);
    return {};
  } catch (e) {
    return toError(e);
  }
}
