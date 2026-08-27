"use server";

/**
 * Mutationer for mødevurderinger (Fase 4.2, ADR 0038). Writes via service-role bag EKSPLICIT
 * berettigelses-tjek, som i resten af møde-domænet (0012-mønsteret).
 *
 * Berettigelse udledes af RELATIONEN til mødet, ikke af rollen alene: både ejeren og de
 * deltagende partnere vurderer, og en bruger kan i princippet have flere roller. Vi spørger
 * derfor "hvad er du på DETTE møde?" frem for "hvilken rolle har du?".
 *
 * Tre regler håndhæves her, fordi ingen af dem kan være en check-constraint:
 *   1. Mødet skal være AFHOLDT. Man vurderer ikke et møde der ikke har fundet sted.
 *   2. Raten skal selv være knyttet til mødet (ejer af boardet, eller deltagende partner).
 *   3. Et partner-subjekt skal faktisk have deltaget i mødet.
 *
 * ⚠ Signerede engangslinks (byggespec §8) er IKKE bygget her. Se ADR 0038: de hører sammen
 * med den notifikation der udsender dem (fase 4.5), og en auth-fri skrivevej der ikke kan
 * afprøves end-to-end er en sikkerhedsrisiko frem for en leverance. Indtil da kræver
 * vurdering login — hvilket byggespec §8's egentlige krav, "ingen åbne endpoints", opfylder.
 * TODO(mads): signerede engangslinks sammen med notifikationsmotoren i 4.5.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthFormState } from "@/components/AuthForm";
import { getCurrentUser, type AuthUser } from "@/server/auth";
import { isSupabaseAuthConfigured, readSupabaseAuthConfig } from "@/server/auth/supabase-config";
import { createServiceSupabase } from "@/server/auth/supabase-server";
import { RATING_MAX, RATING_MIN } from "./index";

interface ActionContext {
  service: SupabaseClient;
  user: AuthUser;
}

async function requireContext(): Promise<ActionContext> {
  const config = readSupabaseAuthConfig();
  if (!isSupabaseAuthConfigured(config)) throw new Error("Supabase er ikke konfigureret.");
  const user = await getCurrentUser();
  if (!user) throw new Error("Adgang nægtet: log ind for at vurdere et møde.");
  return { service: createServiceSupabase(config), user };
}

function toError(e: unknown): AuthFormState {
  return { error: e instanceof Error ? e.message : String(e) };
}

/** Hvem raten er PÅ dette møde. Præcis ét af felterne sættes — spejler check-constrainten. */
type RaterIdentity =
  | { rater_user_id: string; rater_partner_profile_id: null }
  | { rater_user_id: null; rater_partner_profile_id: string };

/**
 * Fastslå brugerens forhold til mødet. Ejer først (billigst), derefter deltagende partner.
 * Kaster hvis brugeren er ingen af delene — vi lader ikke en fremmed skrive en vurdering
 * som service-role blot fordi de kender et møde-id.
 */
async function resolveRater(
  service: SupabaseClient,
  user: AuthUser,
  meetingId: string,
): Promise<RaterIdentity> {
  const { data: asOwner } = await service
    .from("meeting")
    .select("id, board!inner(owner_id)")
    .eq("id", meetingId)
    .eq("board.owner_id", user.id)
    .maybeSingle();
  if (asOwner) return { rater_user_id: user.id, rater_partner_profile_id: null };

  const { data: asPartner } = await service
    .from("meeting_partner")
    .select("partner_profile_id, partner_profile!inner(app_user_id)")
    .eq("meeting_id", meetingId)
    .eq("partner_profile.app_user_id", user.id)
    .maybeSingle();
  if (asPartner) {
    return {
      rater_user_id: null,
      rater_partner_profile_id: (asPartner as { partner_profile_id: string }).partner_profile_id,
    };
  }

  throw new Error("Du deltog ikke i dette møde og kan ikke vurdere det.");
}

/** Mødet skal have fundet sted. Kaster med den ærlige grund hvis ikke. */
async function requireHeldMeeting(service: SupabaseClient, meetingId: string): Promise<void> {
  const { data } = await service
    .from("meeting")
    .select("status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!data) throw new Error("Møde ikke fundet.");
  if ((data as { status: string }).status !== "afholdt") {
    throw new Error("Mødet er ikke afholdt endnu og kan derfor ikke vurderes.");
  }
}

/** Et partner-subjekt skal have deltaget i mødet. Null-subjekt (= hele mødet) er altid gyldigt. */
async function requireValidSubject(
  service: SupabaseClient,
  meetingId: string,
  subjectPartnerProfileId: string | null,
): Promise<void> {
  if (!subjectPartnerProfileId) return;
  const { data } = await service
    .from("meeting_partner")
    .select("partner_profile_id")
    .eq("meeting_id", meetingId)
    .eq("partner_profile_id", subjectPartnerProfileId)
    .maybeSingle();
  if (!data) throw new Error("Den valgte partner deltog ikke i mødet.");
}

function parseScore(raw: string): number | null {
  const score = Number(raw);
  if (!Number.isInteger(score) || score < RATING_MIN || score > RATING_MAX) return null;
  return score;
}

/**
 * Afgiv (eller ret) en vurdering. Upsert på unikheden fra 0015, så en gentagen indsendelse
 * opdaterer frem for at hobe sig op — det er samme vurdering, ikke en ny.
 */
export async function submitRating(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  try {
    const { service, user } = await requireContext();
    const meetingId = String(formData.get("meeting_id") ?? "");
    if (!meetingId) return { error: "Møde-id er påkrævet." };

    const score = parseScore(String(formData.get("score") ?? ""));
    if (score === null) {
      return { error: `Vurderingen skal være et helt tal mellem ${RATING_MIN} og ${RATING_MAX}.` };
    }

    const rawSubject = String(formData.get("subject_partner_profile_id") ?? "").trim();
    const subjectPartnerProfileId = rawSubject.length > 0 ? rawSubject : null;
    const rawComment = String(formData.get("comment") ?? "").trim();

    await requireHeldMeeting(service, meetingId);
    const rater = await resolveRater(service, user, meetingId);
    await requireValidSubject(service, meetingId, subjectPartnerProfileId);

    const { error } = await service.from("meeting_rating").upsert(
      {
        meeting_id: meetingId,
        ...rater,
        subject_partner_profile_id: subjectPartnerProfileId,
        score,
        comment: rawComment.length > 0 ? rawComment : null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict:
          "meeting_id,rater_user_id,rater_partner_profile_id,subject_partner_profile_id",
      },
    );
    if (error) return { error: `Kunne ikke gemme vurderingen: ${error.message}` };

    revalidatePath("/moeder");
    revalidatePath("/partner");
    return {};
  } catch (e) {
    return toError(e);
  }
}
