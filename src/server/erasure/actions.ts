"use server";

/**
 * Admins sletning af en person (GDPR art. 17, ADR 0068) — to server-actions til to-trins-flowet på
 * /admin/juridisk: «Slå op» (viser planen, skriver intet) og «Slet» (bekræftet med e-mailen skrevet
 * igen). Rollen udledes af sessionen (`getCurrentUser`) og service-role tages først efter admin-tjekket
 * i `requestErasure*` — aldrig fra input. Al forretningslogik ligger i ./request og ./execute.
 *
 * TODO(ejer/jura): opbevaringspligt — en person med betalingsdata kan ikke slettes af flowet.
 * TODO(ejer): slette-SLA — hvor hurtigt en anmodning skal effektueres er ikke afgjort.
 */

import { revalidatePath } from "next/cache";

import { createBookingProvider } from "@/lib/booking";
import { createProcessorErasers } from "@/lib/erasure";
import { supabaseRowFetcher } from "@/server/admin/subject-collect";
import { getCurrentUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import type { ErasureDeps, ErasureReceiptView } from "./execute";
import type { ErasurePlan } from "./plan";
import { requestErasure, requestErasurePreview } from "./request";

export interface ErasurePreviewState {
  error?: string;
  plan?: ErasurePlan;
}

export interface ErasureConfirmState {
  error?: string;
  receipt?: ErasureReceiptView;
}

/** Bygges først når admin er bekræftet (lazy i `requestErasure*`). */
function makeDeps(): ErasureDeps {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const service = createServiceSupabase(config);
  return {
    service,
    fetchRows: supabaseRowFetcher(service),
    authAdmin: {
      async deleteUser(userId) {
        const { error } = await service.auth.admin.deleteUser(userId);
        return { error: error ? { message: error.message, status: error.status, code: error.code } : null };
      },
    },
    erasers: createProcessorErasers(),
    booking: createBookingProvider(),
  };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

/** Trin 1: slå personen op og vis planen. */
export async function previewErasure(
  _prev: ErasurePreviewState,
  formData: FormData,
): Promise<ErasurePreviewState> {
  const result = await requestErasurePreview({
    user: await getCurrentUser(),
    email: field(formData, "email"),
    makeDeps,
  });
  return result.ok ? { plan: result.plan } : { error: result.message };
}

/** Trin 2: slet. `user_id` kommer fra planen; `confirm_email` er adressen skrevet igen. */
export async function confirmErasure(
  _prev: ErasureConfirmState,
  formData: FormData,
): Promise<ErasureConfirmState> {
  const result = await requestErasure({
    user: await getCurrentUser(),
    userId: field(formData, "user_id"),
    confirmEmail: field(formData, "confirm_email"),
    makeDeps,
  });
  if (!result.ok) return { error: result.message };

  // Berørte flader følger sletningen (kvitteringslisten, boards, dashboards).
  revalidatePath("/admin/juridisk");
  revalidatePath("/admin/boards");
  revalidatePath("/admin/partners");
  revalidatePath("/admin/drift");
  return { receipt: result.receipt };
}
