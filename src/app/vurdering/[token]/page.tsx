import Link from "next/link";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { formatMeetingTime } from "@/server/notifications/format";
import { redeemRatingLink } from "@/server/ratings/link-actions";
import {
  createRatingLinkDeps,
  LINK_COMMENT_MAX,
  lookupRatingLink,
  type LinkLookup,
} from "@/server/ratings/link-service";
import { RATING_MAX, RATING_MIN } from "@/server/ratings/score";

export const metadata: Metadata = {
  title: "Vurdering — Advisory Board Unlimited",
  // Siden bærer et personligt engangslink i URL'en: ingen indeksering, og ingen Referer-header
  // der kunne lække tokenet videre (siden har ingen eksterne links, men headeren er billig).
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

const SCORE_OPTIONS = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, i) => RATING_MIN + i);

/**
 * Vurdering fra et mail-link (B-21, ADR 0060) — UDEN login. Autorisationen er tokenets
 * signatur: siden validerer den server-side, viser kun møde-tidspunkt og boardnavn, og
 * selve indløsningen sker i server action'en (POST), aldrig ved at åbne siden — en mailscanner
 * der henter linket må ikke brænde det.
 *
 * Alle udfald der ikke er "gyldigt" får en rolig besked. "Ugyldigt" dækker bevidst både et
 * forfalsket token og et id der ikke findes (samme svar, ingen orakel); først når signaturen er
 * bevist gyldig skelnes der mellem "brugt" og "udløbet".
 */
export default async function RatingLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let lookup: LinkLookup | "utilgaengelig";
  try {
    const deps = createRatingLinkDeps();
    lookup = deps ? await lookupRatingLink(deps, token) : { status: "ugyldigt" };
  } catch {
    // Basen kan ikke nås. Intet om tokenets gyldighed følger af det, så det må gerne have sin egen tekst.
    lookup = "utilgaengelig";
  }

  if (lookup === "utilgaengelig") {
    return (
      <Notice
        title="Vurderingen kan ikke åbnes lige nu"
        body="Prøv igen om lidt. Dit link virker stadig."
      />
    );
  }

  switch (lookup.status) {
    case "gyldig":
      return (
        <>
          <PageHeader
            eyebrow="Vurdering"
            title="Hvordan var mødet?"
            lead={
              <>
                {formatMeetingTime(lookup.meeting.startsAt)}
                {lookup.meeting.boardName ? <> · {lookup.meeting.boardName}</> : null}
              </>
            }
          />
          <PageBody>
            <section className="stack measure">
              <p className="body">
                Det tager under et minut. Vurderinger er fortrolige: kun du og administrator kan se
                dem. Linket virker kun én gang.
              </p>
              <AuthForm action={redeemRatingLink} submitLabel="Send vurdering">
                <input type="hidden" name="token" value={token} />
                <Select name="score" label="Mødet samlet set" defaultValue="" required>
                  <option value="" disabled>
                    Vælg
                  </option>
                  {SCORE_OPTIONS.map((score) => (
                    <option key={score} value={score}>
                      {score}
                    </option>
                  ))}
                </Select>
                <TextArea
                  name="comment"
                  label="Kommentar (valgfri)"
                  rows={3}
                  maxLength={LINK_COMMENT_MAX}
                />
              </AuthForm>
            </section>
          </PageBody>
        </>
      );
    case "brugt":
      return (
        <Notice
          title="Tak for din vurdering"
          body="Den er modtaget. Linket kan ikke bruges igen."
        />
      );
    case "udloebet":
      return (
        <Notice
          title="Linket er udløbet"
          body="Du kan stadig vurdere mødet, når du er logget ind."
          login
        />
      );
    case "ugyldigt":
      return (
        <Notice
          title="Linket kan ikke bruges"
          body="Det kan være forkert kopieret eller ikke længere gyldigt."
          login
        />
      );
  }
}

function Notice({ title, body, login }: { title: string; body: string; login?: boolean }) {
  return (
    <>
      <PageHeader eyebrow="Vurdering" title={title} />
      <PageBody>
        <section className="stack measure">
          <p className="body">{body}</p>
          {login ? (
            <p className="body">
              <Link href="/login">Log ind</Link> for at vurdere mødet i stedet.
            </p>
          ) : null}
        </section>
      </PageBody>
    </>
  );
}
