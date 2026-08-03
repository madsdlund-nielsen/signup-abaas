/**
 * Board-matching (Fase 1.5, ADR 0022). Byggespec §5.2: "dæk kompetencer med 2-3 partnere" — et lille
 * set-cover-problem. Ejerens kompetence-tags (fra quiz-svarene) matches mod partnernes tags, og der
 * vælges 2-3 katalogposter der tilsammen dækker mest muligt.
 *
 * BEVIDST REN: ingen Supabase-, env- eller React-afhængigheder. Læsevejen ligger i ./index, så selve
 * algoritmen kan unit-testes uden DB.
 */

/** Byggespec §0 (V4→V5): boardstørrelsen gik fra 2-6 til 2-3. */
export const MIN_BOARD_SIZE = 2;
export const MAX_BOARD_SIZE = 3;

export interface MatchCandidate {
  id: string;
  name: string;
  /** Intern (fast) partner. Byggespec §3/§5.6: altid mindst 1 intern pr. board. */
  isInternal: boolean;
  sortOrder: number;
  competenceTagIds: string[];
}

export interface BoardMatch {
  /** 2-3 partnere i valgt rækkefølge (den interne først). */
  partnerIds: string[];
  /** Af ejerens ønskede tags: dem boardet dækker — i ejerens egen rækkefølge. */
  coveredTagIds: string[];
  /** Ønskede tags ingen valgt partner dækker. Driver "kompetencegab" i UI'et. */
  uncoveredTagIds: string[];
  /**
   * Er kravet om mindst 1 intern partner opfyldt? Falsk kun hvis puljen slet ingen interne har —
   * da kan boardet ikke gemmes (byggespec §3: "flag valideret ved board-oprettelse").
   */
  hasInternalPartner: boolean;
}

export interface SwapDelta {
  /** Ønskede tags der ikke længere er dækket efter udskiftningen. */
  removedTagIds: string[];
  /** Ønskede tags der bliver dækket af udskiftningen. */
  addedTagIds: string[];
}

/**
 * Deterministisk rækkefølge: sort_order, derefter navn, derefter id.
 *
 * TODO(ejer): tie-break-regler ved lige gode kandidater. Byggespec §5.2 flager spørgsmålet
 * ("rating? tilgængelighed?") og henviser til §12 — men det punkt findes ikke i spec'ens tabel, og
 * rating (fase 4) og tilgængelighed (fase 5) findes endnu ikke som data. Indtil ejer beslutter:
 * ovenstående faste rækkefølge, så et match aldrig ændrer sig mellem to kørsler.
 */
function byDeterministicOrder(a: MatchCandidate, b: MatchCandidate): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  const byName = a.name.localeCompare(b.name, "da");
  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/** Ønskede tags som en given kandidat dækker. */
function coveredBy(candidate: MatchCandidate, wanted: ReadonlySet<string>): string[] {
  return candidate.competenceTagIds.filter((tagId) => wanted.has(tagId));
}

/** Samlet dækning af ønskede tags for et sæt kandidater. */
function coverageOf(candidates: readonly MatchCandidate[], wanted: ReadonlySet<string>): Set<string> {
  const covered = new Set<string>();
  for (const candidate of candidates) {
    for (const tagId of coveredBy(candidate, wanted)) covered.add(tagId);
  }
  return covered;
}

/**
 * Grådig set-cover med to hårde krav fra byggespec: 2-3 partnere, mindst 1 intern.
 *
 * Den interne vælges FØRST (den bedst dækkende), så kravet er opfyldt ved konstruktion frem for ved
 * en efterfølgende ombytning. Grådig dækning er ikke garanteret optimal, men set-cover er NP-hårdt,
 * og puljen er lille — se ADR 0022.
 */
export function matchBoard(
  ownerTagIds: readonly string[],
  candidates: readonly MatchCandidate[],
): BoardMatch {
  const wantedOrdered = [...new Set(ownerTagIds)];
  const wanted = new Set(wantedOrdered);

  const pool = [...candidates].sort(byDeterministicOrder);
  const selected: MatchCandidate[] = [];
  const selectedIds = new Set<string>();
  const covered = new Set<string>();

  function newCoverage(candidate: MatchCandidate): number {
    return coveredBy(candidate, wanted).filter((tagId) => !covered.has(tagId)).length;
  }

  /** Bedste kandidat efter ny dækning; `pool`-rækkefølgen afgør uafgjort (streng >). */
  function pickBest(from: readonly MatchCandidate[]): MatchCandidate | undefined {
    let best: MatchCandidate | undefined;
    let bestScore = -1;
    for (const candidate of from) {
      const score = newCoverage(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best;
  }

  function take(candidate: MatchCandidate): void {
    selected.push(candidate);
    selectedIds.add(candidate.id);
    for (const tagId of coveredBy(candidate, wanted)) covered.add(tagId);
  }

  // 1. Mindst 1 intern partner (byggespec §3/§5.6) — opfyldt ved konstruktion.
  const bestInternal = pickBest(pool.filter((candidate) => candidate.isInternal));
  if (bestInternal) take(bestInternal);

  // 2. Grådig dækning af resten, indtil alt er dækket eller boardet er fyldt.
  while (selected.length < MAX_BOARD_SIZE && covered.size < wanted.size) {
    const best = pickBest(pool.filter((candidate) => !selectedIds.has(candidate.id)));
    if (!best || newCoverage(best) === 0) break;
    take(best);
  }

  // 3. Top op til minimumsstørrelsen — et board på 1 partner er ikke et board.
  for (const candidate of pool) {
    if (selected.length >= MIN_BOARD_SIZE) break;
    if (!selectedIds.has(candidate.id)) take(candidate);
  }

  return {
    partnerIds: selected.map((candidate) => candidate.id),
    coveredTagIds: wantedOrdered.filter((tagId) => covered.has(tagId)),
    uncoveredTagIds: wantedOrdered.filter((tagId) => !covered.has(tagId)),
    hasInternalPartner: selected.some((candidate) => candidate.isInternal),
  };
}

/**
 * Kompetence-delta ved "udskift" (fase-1.md §1.5: infobaren forklarer hvorfor et match ændrede sig).
 *
 * Byggespec §5.2 beskriver infobaren som en PRIS-visning, men startpris/meeting-fee er et uafklaret
 * punkt (CLAUDE.md), og `docs/fase-1.md` — som er styrende — omdefinerer den til kompetence-delta.
 * TODO(ejer): startpris/meeting-fee, før infobaren kan vise pris.
 */
export function computeSwapDelta(
  ownerTagIds: readonly string[],
  current: readonly MatchCandidate[],
  outgoingId: string,
  incoming: MatchCandidate,
): SwapDelta {
  const wanted = new Set(ownerTagIds);
  const before = coverageOf(current, wanted);
  const after = coverageOf(
    [...current.filter((candidate) => candidate.id !== outgoingId), incoming],
    wanted,
  );

  const ordered = [...new Set(ownerTagIds)];
  return {
    removedTagIds: ordered.filter((tagId) => before.has(tagId) && !after.has(tagId)),
    addedTagIds: ordered.filter((tagId) => !before.has(tagId) && after.has(tagId)),
  };
}
