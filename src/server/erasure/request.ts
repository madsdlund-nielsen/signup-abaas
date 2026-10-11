/**
 * Sletteanmodningen — rækkefølgen (ADR 0068), samme mønster som `requestSubjectAccess` (ADR 0053).
 * Den ligger her og ikke i server-action'en, så den kan afprøves:
 *   1. Er der en bruger? 2. Er brugeren admin? FØR noget andet — og først derefter bygges
 *      afhængighederne (`makeDeps` er lazy: service-role-klienten, Auth-admin og adapterne).
 *      En ikke-admin — også en ejer der beder om sin EGEN sletning — får aldrig en klient der
 *      bypasser RLS. (Selvbetjent sletning er en anden skive; admin gør det på vegne.)
 *   3. Gyldigt input. 4. Planen / udførelsen.
 *
 * Action'en oversætter udfaldet til tilstand for formularen; den kender ingen forretningslogik.
 */

import { normaliseEmail } from "@/server/admin/subject-access";
import type { AuthUser } from "@/server/auth";
import { executeErasure, type ErasureDeps, type ErasureReceiptView } from "./execute";
import { planErasure, type ErasurePlan } from "./plan";

export type ErasureRequestFailure =
  | "ikke-logget-ind"
  | "ikke-admin"
  | "ugyldig-email"
  | "ugyldigt-id"
  | "ikke-fundet"
  | "email-matcher-ikke"
  | "blokeret"
  | "fejlet";

export const REQUEST_ERRORS: Record<ErasureRequestFailure, string> = {
  "ikke-logget-ind": "Adgang nægtet: du skal være logget ind.",
  "ikke-admin": "Adgang nægtet: kun en admin kan slette en person.",
  "ugyldig-email": "Det ligner ikke en e-mailadresse. Tjek stavningen og prøv igen.",
  "ugyldigt-id": "Ugyldigt person-id. Slå personen op igen.",
  "ikke-fundet": "Ingen konto har den e-mailadresse. Er personen allerede slettet, er der intet mere at gøre.",
  "email-matcher-ikke": "E-mailen matcher ikke kontoen. Intet er slettet.",
  blokeret: "Sletningen er blokeret.",
  fejlet: "Sletningen kunne ikke gennemføres. Intet er slettet.",
};

export type PreviewResult =
  | { ok: true; plan: ErasurePlan }
  | { ok: false; code: ErasureRequestFailure; message: string };

export type ExecutionResult =
  | { ok: true; receipt: ErasureReceiptView }
  | { ok: false; code: ErasureRequestFailure; message: string; plan?: ErasurePlan };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function gate(user: AuthUser | null): { ok: false; code: ErasureRequestFailure; message: string } | null {
  if (!user) return { ok: false, code: "ikke-logget-ind", message: REQUEST_ERRORS["ikke-logget-ind"] };
  if (!user.roles.includes("admin")) return { ok: false, code: "ikke-admin", message: REQUEST_ERRORS["ikke-admin"] };
  return null;
}

/** Trin 1 i den to-trins bekræftelse: slå op på e-mail og vis planen. Skriver ingenting. */
export async function requestErasurePreview(input: {
  user: AuthUser | null;
  /** Rå e-mail fra formularen. Gemmes, logges og returneres aldrig. */
  email: string;
  makeDeps: () => ErasureDeps;
}): Promise<PreviewResult> {
  const denied = gate(input.user);
  if (denied) return denied;
  const admin = input.user as AuthUser;

  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, code: "ugyldig-email", message: REQUEST_ERRORS["ugyldig-email"] };

  try {
    const deps = input.makeDeps();
    const [user] = await deps.fetchRows({ table: "app_user", columns: "id", eq: { column: "email", value: email } });
    if (!user) return { ok: false, code: "ikke-fundet", message: REQUEST_ERRORS["ikke-fundet"] };
    const plan = await planErasure(deps.fetchRows, String(user.id), admin.id, deps.now?.());
    return { ok: true, plan };
  } catch (e) {
    // Fejlbeskeden nævner tabel + databasefejl, aldrig filterværdier (e-mail, id'er).
    console.error(`[erasure] planlægning fejlede: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, code: "fejlet", message: "Planen kunne ikke lægges. Se serverloggen — den indeholder ikke persondata." };
  }
}

/** Trin 2: den bekræftede sletning. `userId` kommer fra planen, `confirmEmail` er skrevet igen. */
export async function requestErasure(input: {
  user: AuthUser | null;
  userId: string;
  confirmEmail: string;
  makeDeps: () => ErasureDeps;
}): Promise<ExecutionResult> {
  const denied = gate(input.user);
  if (denied) return denied;
  const admin = input.user as AuthUser;

  if (!UUID.test(input.userId)) return { ok: false, code: "ugyldigt-id", message: REQUEST_ERRORS["ugyldigt-id"] };
  if (!normaliseEmail(input.confirmEmail)) {
    return { ok: false, code: "ugyldig-email", message: REQUEST_ERRORS["ugyldig-email"] };
  }

  try {
    const result = await executeErasure(input.makeDeps(), {
      adminId: admin.id,
      userId: input.userId,
      confirmEmail: input.confirmEmail,
    });
    return result;
  } catch (e) {
    console.error(`[erasure] sletning fejlede: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, code: "fejlet", message: REQUEST_ERRORS.fejlet };
  }
}
