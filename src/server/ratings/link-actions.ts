"use server";

/**
 * Indløsning af et rating-link (B-21, ADR 0060) — den AUTH-FRIE skrivevej. Ingen session, ingen
 * `getCurrentUser`: autorisationen er tokenets HMAC-signatur plus engangsindløsningen i basen,
 * begge afgjort i `./link-service`. Denne fil er kun limningen mellem formularen og servicen.
 *
 * Indløsningen sker KUN her, i en POST (server action) — aldrig ved at åbne siden. Mailscannere
 * og link-preview henter GET-ruten; hvis den indløste, ville linket være brændt, før modtageren
 * så det.
 */

import { redirect } from "next/navigation";

import type { AuthFormState } from "@/components/AuthForm";
import { scrubError } from "@/server/notifications/scrub";

import {
  createRatingLinkDeps,
  INVALID_LINK_MESSAGE,
  redeemRatingLinkToken,
  type RedeemResult,
} from "./link-service";

export async function redeemRatingLink(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");

  let result: RedeemResult;
  try {
    const deps = createRatingLinkDeps();
    if (!deps) return { error: INVALID_LINK_MESSAGE };
    result = await redeemRatingLinkToken(deps, token, {
      score: String(formData.get("score") ?? ""),
      comment: String(formData.get("comment") ?? ""),
    });
  } catch (error) {
    // Aldrig token eller basens tekst til brugeren; den skrubbede fejl til loggen.
    console.error(`[ratings] indløsning af rating-link fejlede: ${scrubError(error)}`);
    return { error: "Vurderingen kunne ikke gemmes lige nu. Prøv igen om lidt." };
  }

  switch (result.status) {
    case "gemt":
      // Siden viser nu "tak" (linket er brugt) — samme side, så et genindlæs ikke giver en fejl.
      redirect(`/vurdering/${encodeURIComponent(token)}`);
    case "ugyldigt-input":
      return { error: result.message };
    case "brugt":
      return { error: "Linket er allerede brugt — din vurdering er modtaget." };
    case "udloebet":
      return { error: "Linket er udløbet. Log ind for at vurdere mødet i stedet." };
    case "ugyldigt":
      return { error: INVALID_LINK_MESSAGE };
  }
}
