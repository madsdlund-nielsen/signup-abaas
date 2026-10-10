/**
 * Kompetenceoverblik for lead-partnerens dashboard (fase 5.4, ADR 0055). Spørgsmålet: af de
 * kompetencer ejeren har brug for, hvilke dækker boardet — og hvem dækker dem?
 *
 * BEVIDST REN, som `matching/algorithm.ts`: ingen Supabase-, env- eller React-afhængigheder.
 * Det er et overblik, ikke en anbefaling — der vælges ingen partner, og intet her afgør hvem
 * der bør skiftes ud (tie-break og rating er stadig ejerens punkt, se matching/algorithm.ts).
 */

export interface CoverageMember {
  partnerId: string;
  name: string;
  competenceTagIds: readonly string[];
}

export interface NeedCoverage {
  tagId: string;
  /** Boardets medlemmer der dækker behovet, i boardets rækkefølge. Tom = udækket. */
  coveredBy: Array<{ partnerId: string; name: string }>;
}

export interface BoardCoverage {
  /** Ejerens behov (unikke, i hendes rækkefølge) med hvem der dækker dem. */
  needs: NeedCoverage[];
  coveredTagIds: string[];
  uncoveredTagIds: string[];
}

/**
 * Dæknings-overblik for et board. Duplikerede behov tælles én gang; et medlems tags ud over
 * ejerens behov indgår ikke (de er ikke et behov og skal ikke fremstå som en dækning).
 */
export function computeBoardCoverage(
  ownerTagIds: readonly string[],
  members: readonly CoverageMember[],
): BoardCoverage {
  const needs: NeedCoverage[] = [...new Set(ownerTagIds)].map((tagId) => ({
    tagId,
    coveredBy: members
      .filter((member) => member.competenceTagIds.includes(tagId))
      .map((member) => ({ partnerId: member.partnerId, name: member.name })),
  }));

  return {
    needs,
    coveredTagIds: needs.filter((need) => need.coveredBy.length > 0).map((need) => need.tagId),
    uncoveredTagIds: needs.filter((need) => need.coveredBy.length === 0).map((need) => need.tagId),
  };
}

/** Sidder partneren som lead på boardet? (Samme udledning som /partner: lead er data på boardet.) */
export function isLeadOnBoard(
  partnerProfileId: string | null | undefined,
  board: { members: ReadonlyArray<{ partnerId: string; isLead: boolean }> } | null | undefined,
): boolean {
  if (!partnerProfileId || !board) return false;
  return board.members.some((member) => member.partnerId === partnerProfileId && member.isLead);
}
