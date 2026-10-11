/**
 * Indsigtsudtræk — anmodningsflowet (fase 5.5, ADR 0053).
 *
 * Rækkefølgen er bærende, og den ligger her og ikke i route handleren, så den kan afprøves:
 *   1. Er der en bruger? 2. Er brugeren admin? FØR noget andet — og først derefter bygges
 *   service-role-fetcheren (`makeFetcher` er lazy). En ikke-admin når aldrig at få en klient
 *   der bypasser RLS.
 *   3. Er e-mailen gyldig? 4. Findes personen? 5. Sæt udtrækket sammen.
 *
 * Route handleren oversætter udfaldet til HTTP; den kender ingen forretningslogik.
 */

import type { AuthUser } from "@/server/auth";
import {
  composeSubjectAccessExport,
  exportFileName,
  normaliseEmail,
} from "./subject-access";
import { collectSubjectData, type RowFetcher } from "./subject-collect";

export type SubjectRequestFailure =
  | "ikke-logget-ind"
  | "ikke-admin"
  | "ugyldig-email"
  | "ikke-fundet";

export type SubjectRequestResult =
  | { ok: true; body: string; fileName: string }
  | { ok: false; code: SubjectRequestFailure };

export interface SubjectRequestInput {
  user: AuthUser | null;
  /** Rå e-mail fra formularen. Gemmes, logges og returneres aldrig i en fejl. */
  email: string;
  /** Bygger service-role-fetcheren. Kaldes kun efter at brugeren er bekræftet som admin. */
  makeFetcher: () => RowFetcher;
  now?: Date;
}

export async function requestSubjectAccess(input: SubjectRequestInput): Promise<SubjectRequestResult> {
  if (!input.user) return { ok: false, code: "ikke-logget-ind" };
  if (!input.user.roles.includes("admin")) return { ok: false, code: "ikke-admin" };

  const email = normaliseEmail(input.email);
  if (!email) return { ok: false, code: "ugyldig-email" };

  const raw = await collectSubjectData(input.makeFetcher(), email);
  if (!raw) return { ok: false, code: "ikke-fundet" };

  const generatedAt = (input.now ?? new Date()).toISOString();
  const document = composeSubjectAccessExport(raw, { generatedAt });
  return {
    ok: true,
    body: JSON.stringify(document, null, 2),
    fileName: exportFileName(generatedAt),
  };
}
