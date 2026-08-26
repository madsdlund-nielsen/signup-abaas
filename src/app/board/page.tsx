import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/server/auth";
import { getMyBoard, type BoardMember } from "@/server/boards";
import { addBoardPartner, approveBoard, removeBoardPartner, swapBoardPartner } from "@/server/boards/actions";
import { isEnabled } from "@/server/flags";
import {
  computeSwapDelta,
  getMyCompetenceTagIds,
  listMatchCandidates,
  matchBoard,
  MAX_BOARD_SIZE,
  type MatchCandidate,
  type MatchPartner,
} from "@/server/matching";
import { listTags } from "@/server/tags";
import { PartnerCard } from "@/components/PartnerCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { Select } from "@/components/Select";

export const metadata: Metadata = { title: "Dit board — Advisory Board Unlimited" };

// Afhænger af session + RLS-scopede læsninger — aldrig statisk prerender.
export const dynamic = "force-dynamic";

/** Board-medlem → matchkandidat, så delta-beregningen kan bruge samme form som puljen. */
function memberToCandidate(member: BoardMember): MatchCandidate {
  return {
    id: member.partnerId,
    name: member.name,
    isInternal: member.isInternal,
    sortOrder: member.sortOrder,
    competenceTagIds: member.competenceTagIds,
  };
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ udskiftet?: string; til?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.roles.includes("ejer")) redirect("/dashboard");

  const { udskiftet, til } = await searchParams;
  const [board, ownerTagIds, pool, tags] = await Promise.all([
    getMyBoard(),
    getMyCompetenceTagIds(),
    listMatchCandidates(),
    listTags(),
  ]);

  const tagLabels = new Map(tags.map((tag) => [tag.id, tag.label]));
  const poolById = new Map(pool.map((partner) => [partner.id, partner]));
  const showLead = isEnabled("leadPartner");

  // Enten det godkendte board, eller — hvis ejeren endnu ikke har godkendt — en frisk anbefaling.
  const recommendation = board ? null : matchBoard(ownerTagIds, pool);
  const shown: Array<{ partner: MatchPartner | BoardMember; id: string; isLead: boolean }> = board
    ? board.members.map((member) => ({ partner: member, id: member.partnerId, isLead: member.isLead }))
    : (recommendation?.partnerIds ?? [])
        .map((id) => poolById.get(id))
        .filter((partner): partner is MatchPartner => partner != null)
        .map((partner) => ({ partner, id: partner.id, isLead: false }));

  const shownIds = new Set(shown.map((entry) => entry.id));
  const uncoveredTagIds = recommendation
    ? recommendation.uncoveredTagIds
    : ownerTagIds.filter(
        (tagId) => !board?.members.some((member) => member.competenceTagIds.includes(tagId)),
      );

  // Forklar den seneste udskiftning: rekonstruér boardet FØR skiftet og sammenlign dækningen.
  const outgoing = udskiftet ? poolById.get(udskiftet) : undefined;
  const incoming = til ? poolById.get(til) : undefined;
  const delta =
    board && outgoing && incoming
      ? computeSwapDelta(
          ownerTagIds,
          board.members.map((member) =>
            member.partnerId === incoming.id ? outgoing : memberToCandidate(member),
          ),
          outgoing.id,
          incoming,
        )
      : null;

  return (
    <main className="container stack">
      <p className="eyebrow">Advisory Board Unlimited</p>
      <h1 className="heading-2 heading--on-light">{board ? "Dit board" : "Dit anbefalede board"}</h1>

      {pool.length === 0 ? (
        <p className="form__notice" role="status">
          Der er endnu ingen partnere i kataloget. Kontakt os, så sammensætter vi dit board.
        </p>
      ) : null}

      {shown.length > 0 ? (
        <p className="body">
          {board
            ? "Sådan ser dit board ud lige nu."
            : "Vi har sammensat et board der dækker de kompetencer, du valgte i quizzen."}{" "}
          <abbr title="Boardet vælges, så 2-3 partnere tilsammen dækker flest mulige af de kompetencer, du valgte. Der er altid mindst én intern partner med.">
            (i)
          </abbr>
        </p>
      ) : null}

      {delta ? (
        <div className="board-infobar" role="status">
          <p className="body">
            {outgoing?.name} er skiftet ud med {incoming?.name}.
          </p>
          <p className="board-infobar__detail">
            {delta.addedTagIds.length > 0
              ? `Tilkommer: ${delta.addedTagIds.map((id) => tagLabels.get(id) ?? id).join(", ")}. `
              : ""}
            {delta.removedTagIds.length > 0
              ? `Udgår: ${delta.removedTagIds.map((id) => tagLabels.get(id) ?? id).join(", ")}.`
              : ""}
            {delta.addedTagIds.length === 0 && delta.removedTagIds.length === 0
              ? "Din kompetencedækning er uændret."
              : ""}
          </p>
        </div>
      ) : null}

      {uncoveredTagIds.length > 0 && shown.length > 0 ? (
        <p className="form__notice" role="status">
          Ikke dækket endnu: {uncoveredTagIds.map((id) => tagLabels.get(id) ?? id).join(", ")}.
        </p>
      ) : null}

      {recommendation && !recommendation.hasInternalPartner && shown.length > 0 ? (
        <p className="form__notice" role="alert">
          Boardet mangler en intern partner og kan derfor ikke godkendes endnu.
        </p>
      ) : null}

      <div className="card-grid">
        {shown.map(({ partner, id, isLead }) => (
          <PartnerCard
            key={id}
            partner={{
              id,
              name: partner.name,
              title: partner.title,
              photoUrl: partner.photoUrl,
              shortBio: partner.shortBio,
              competenceTagIds: partner.competenceTagIds,
            }}
            tagLabels={tagLabels}
            wantedTagIds={ownerTagIds}
            isLead={isLead}
            showLead={showLead}
          >
            {board ? (
              <div className="stack">
                <form className="row-form" action={swapBoardPartner}>
                  <input type="hidden" name="board_id" value={board.id} />
                  <input type="hidden" name="outgoing" value={id} />
                  <Select name="incoming" label="Udskift med" defaultValue="">
                    <option value="" disabled>
                      Vælg partner
                    </option>
                    {pool
                      .filter((candidate) => !shownIds.has(candidate.id))
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </Select>
                  <button className="btn-secondary" type="submit">
                    Udskift
                  </button>
                </form>
                {board.members.length > 2 ? (
                  <form action={removeBoardPartner}>
                    <input type="hidden" name="board_id" value={board.id} />
                    <input type="hidden" name="partner" value={id} />
                    <button className="btn-secondary" type="submit">
                      Fjern fra boardet
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </PartnerCard>
        ))}
      </div>

      {!board && shown.length > 0 ? (
        <form className="form measure" action={approveBoard}>
          {shown.map(({ id }) => (
            <input key={id} type="hidden" name="partner" value={id} />
          ))}
          <PrimaryButton type="submit" disabled={!recommendation?.hasInternalPartner}>
            Godkend board
          </PrimaryButton>
        </form>
      ) : null}

      {shown.length === 0 && pool.length > 0 ? (
        <p className="body">
          Vi mangler dine svar for at kunne sammensætte et board.{" "}
          <Link className="btn-secondary" href="/onboarding">
            Start onboarding
          </Link>
        </p>
      ) : null}

      {board && board.members.length < MAX_BOARD_SIZE && pool.some((c) => !shownIds.has(c.id)) ? (
        <form className="row-form measure" action={addBoardPartner}>
          <input type="hidden" name="board_id" value={board.id} />
          <Select name="partner" label="Udvid boardet med en partner" defaultValue="">
            <option value="" disabled>
              Vælg partner
            </option>
            {pool
              .filter((candidate) => !shownIds.has(candidate.id))
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
          </Select>
          <button className="btn-secondary" type="submit">
            Tilføj
          </button>
        </form>
      ) : null}

      <p className="body">
        Du kan frit udskifte board-medlemmer — der er højst {MAX_BOARD_SIZE} partnere på et board.
        Ændringer i boardstørrelse og frekvens slår igennem i prisen fra næste afholdte møde.{" "}
        <span className="row-form">
          <Link className="btn-secondary" href="/betaling">
            Betaling
          </Link>
          <Link href="/dashboard">Til dashboard</Link>
        </span>
      </p>
    </main>
  );
}
