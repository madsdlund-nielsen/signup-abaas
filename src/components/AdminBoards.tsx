import Link from "next/link";

import { AuthForm, type AuthAction } from "@/components/AuthForm";
import { BoardActionForm, type BoardAction } from "@/components/BoardActionForm";
import { Select } from "@/components/Select";
import { StatusBadge } from "@/components/StatusBadge";
import type { BoardChangeRow } from "@/server/boards/audit";
import type { AdminBoardDetail, AdminBoardOverview } from "@/server/boards/admin";
import { listSwapOptions } from "@/server/boards/swap-options";
import { computeBoardCoverage } from "@/server/dashboard/coverage";
import { MAX_BOARD_SIZE, MIN_BOARD_SIZE } from "@/server/matching/algorithm";

/**
 * Admins board-flade (ADR 0062): overblikket over alle boards og editoren for ét board. Rene
 * præsentationskomponenter — data og server-actions kommer som props, så de kan testes uden
 * Supabase. Al styling via token-klasser.
 */

const MEMBERSHIP_LABEL: Record<string, string> = { aktiv: "Aktivt", opsagt: "Opsagt" };

function memberLabel(member: AdminBoardOverview["members"][number]): string {
  const parts = [member.isInternal ? "intern" : "ekstern"];
  if (member.isLead) parts.push("lead");
  return `${member.name} (${parts.join(", ")})`;
}

/** Overblikket: ét board pr. række, med link til editoren. */
export function AdminBoardTable({ boards }: { boards: AdminBoardOverview[] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="table__head">Board</th>
            <th className="table__head">Ejer</th>
            <th className="table__head">Partnere</th>
            <th className="table__head table__head--num">Møder</th>
            <th className="table__head">Medlemskab</th>
            <th className="table__head">Cal.com</th>
          </tr>
        </thead>
        <tbody>
          {boards.map((board) => (
            <tr key={board.id} className="table__row">
              <td className="table__cell">
                <Link href={`/admin/boards/${board.id}`}>{board.name}</Link>
              </td>
              <td className="table__cell">{board.ownerLabel ?? "—"}</td>
              <td className="table__cell">
                {board.members.length === 0 ? "ingen" : board.members.map(memberLabel).join(", ")}
              </td>
              <td className="table__cell table__cell--num">{board.meetingCount}</td>
              <td className="table__cell">
                {board.membershipStatus ? MEMBERSHIP_LABEL[board.membershipStatus] : "Intet endnu"}
              </td>
              <td className="table__cell">
                {board.calcomEventTypeId != null ? `Event type ${board.calcomEventTypeId}` : "Ikke oprettet"}
                {board.hostsOutOfSync ? (
                  <>
                    {" "}
                    <StatusBadge tone="draft">Hosts hænger efter</StatusBadge>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ACTION_LABEL: Record<BoardChangeRow["action"], string> = {
  tilfoej: "tilføjede",
  fjern: "fjernede",
  udskift: "udskiftede",
  saet_lead: "satte lead:",
  opdater_hosts: "opdaterede Cal.com-hosts",
};

const SYNC_LABEL: Record<BoardChangeRow["calcomSync"], string> = {
  opdateret: "Opdateret",
  fejlet: "Fejlede",
  sprunget_over: "—",
};

/** «Admin udskiftede X med Y» — navne slås op i puljen; en slettet katalogpost bliver «en slettet partner». */
export function describeBoardChange(change: BoardChangeRow, nameOf: (id: string | null) => string): string {
  const who = change.actorRole === "admin" ? "Admin" : "Ejeren";
  switch (change.action) {
    case "udskift":
      return `${who} udskiftede ${nameOf(change.replacedPartnerId)} med ${nameOf(change.partnerId)}`;
    case "opdater_hosts":
      return `${who} ${ACTION_LABEL.opdater_hosts}`;
    default:
      return `${who} ${ACTION_LABEL[change.action]} ${nameOf(change.partnerId)}`;
  }
}

export interface AdminBoardEditorActions {
  add: BoardAction;
  remove: BoardAction;
  swap: BoardAction;
  setLead: BoardAction;
  syncHosts: AuthAction;
}

function labelsOf(ids: readonly string[], tagLabels: Record<string, string>): string {
  return ids.map((id) => tagLabels[id] ?? id).join(", ");
}

/**
 * Editoren for ét board: medlemmer, kompetencedækning, tilføj/udskift, Cal.com-hosts og de
 * seneste ændringer. `swapOutgoingId` åbner kandidatlisten med delta for den partner.
 */
export function AdminBoardEditor({
  board,
  tagLabels,
  showLead,
  swapOutgoingId,
  actions,
}: {
  board: AdminBoardDetail;
  tagLabels: Record<string, string>;
  showLead: boolean;
  swapOutgoingId: string | null;
  actions: AdminBoardEditorActions;
}) {
  const memberIds = new Set(board.members.map((m) => m.partnerId));
  const outside = board.pool.filter((partner) => !memberIds.has(partner.id));
  const nameById = new Map(board.pool.map((partner) => [partner.id, partner.name]));
  const nameOf = (id: string | null) => (id ? (nameById.get(id) ?? "en slettet partner") : "en slettet partner");

  const swapping = swapOutgoingId ? board.members.find((m) => m.partnerId === swapOutgoingId) : undefined;
  // Uden læste behov (null) vises kandidaterne uden delta; invariant-tjekket gælder stadig.
  const swapOptions = swapping
    ? listSwapOptions(
        board.ownerTagIds ?? [],
        board.members.map((m) => ({
          id: m.partnerId,
          name: m.name,
          isInternal: m.isInternal,
          sortOrder: 0,
          competenceTagIds: m.competenceTagIds,
        })),
        swapping.partnerId,
        board.pool,
      )
    : [];

  const coverage = board.ownerTagIds
    ? computeBoardCoverage(
        board.ownerTagIds,
        board.members.map((m) => ({
          partnerId: m.partnerId,
          name: m.name,
          competenceTagIds: m.competenceTagIds,
        })),
      )
    : null;

  const withoutSeat = board.members.filter((m) => !m.hasCalcomUser).map((m) => m.name);

  return (
    <div className="stack">
      <div className="panel panel--flat">
        <p className="body">
          Ejer: {board.ownerLabel ?? "—"}
          {board.ownerEmail && board.ownerEmail !== board.ownerLabel ? ` (${board.ownerEmail})` : ""}
        </p>
        <p className="body">
          Møder: {board.meetingCount} · Medlemskab:{" "}
          {board.membershipStatus ? MEMBERSHIP_LABEL[board.membershipStatus] : "intet endnu"}
        </p>
      </div>

      <h2 className="heading-3 heading--on-light">Partnere på boardet</h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="table__head">Partner</th>
              <th className="table__head">Type</th>
              <th className="table__head">Lead</th>
              <th className="table__head">Cal.com-sæde</th>
              <th className="table__head">Handling</th>
            </tr>
          </thead>
          <tbody>
            {board.members.map((member) => (
              <tr key={member.partnerId} className="table__row">
                <td className="table__cell">
                  {member.name}
                  {member.title ? ` — ${member.title}` : ""}
                </td>
                <td className="table__cell">{member.isInternal ? "Intern" : "Ekstern"}</td>
                <td className="table__cell">
                  {member.isLead ? (
                    <StatusBadge tone="live">Lead</StatusBadge>
                  ) : showLead && member.isInternal ? (
                    <BoardActionForm action={actions.setLead} submitLabel="Gør til lead">
                      <input type="hidden" name="board_id" value={board.id} />
                      <input type="hidden" name="partner" value={member.partnerId} />
                    </BoardActionForm>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="table__cell">{member.hasCalcomUser ? "Ja" : "Mangler"}</td>
                <td className="table__cell">
                  <div className="stack">
                    <Link className="btn-secondary" href={`/admin/boards/${board.id}?udskift=${member.partnerId}#udskift`}>
                      Udskift
                    </Link>
                    {board.members.length > MIN_BOARD_SIZE ? (
                      <BoardActionForm action={actions.remove} submitLabel="Fjern">
                        <input type="hidden" name="board_id" value={board.id} />
                        <input type="hidden" name="partner" value={member.partnerId} />
                      </BoardActionForm>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="body">
        Et board har {MIN_BOARD_SIZE}-{MAX_BOARD_SIZE} partnere, mindst én intern, og lead er altid en intern
        partner. Ændringer slår igennem i ejerens pris fra næste periode.
      </p>

      {swapping ? (
        <div id="udskift" className="stack">
          <h2 className="heading-3 heading--on-light">Udskift {swapping.name}</h2>
          {board.ownerTagIds === null ? (
            <p className="form__notice" role="alert">
              Ejerens behov kunne ikke læses, så kompetence-deltaet kan ikke vises.
            </p>
          ) : null}
          {swapOptions.length === 0 ? (
            <p className="body">Der er ingen andre partnere i kataloget.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="table__head">Kandidat</th>
                    <th className="table__head">Type</th>
                    <th className="table__head">Tilkommer</th>
                    <th className="table__head">Udgår</th>
                    <th className="table__head">Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {swapOptions.map(({ candidate, delta, keepsInternal }) => (
                    <tr key={candidate.id} className="table__row">
                      <td className="table__cell">{candidate.name}</td>
                      <td className="table__cell">{candidate.isInternal ? "Intern" : "Ekstern"}</td>
                      <td className="table__cell">
                        {delta.addedTagIds.length > 0 ? labelsOf(delta.addedTagIds, tagLabels) : "—"}
                      </td>
                      <td className="table__cell">
                        {delta.removedTagIds.length > 0 ? labelsOf(delta.removedTagIds, tagLabels) : "—"}
                      </td>
                      <td className="table__cell">
                        {keepsInternal ? (
                          <BoardActionForm action={actions.swap} submitLabel="Udskift med denne">
                            <input type="hidden" name="board_id" value={board.id} />
                            <input type="hidden" name="outgoing" value={swapping.partnerId} />
                            <input type="hidden" name="incoming" value={candidate.id} />
                          </BoardActionForm>
                        ) : (
                          "Boardet ville mangle en intern partner"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="body">
            <Link href={`/admin/boards/${board.id}`}>Annullér udskiftning</Link>
          </p>
        </div>
      ) : null}

      <h2 className="heading-3 heading--on-light">Tilføj partner</h2>
      {board.members.length >= MAX_BOARD_SIZE ? (
        <p className="body">Boardet er fuldt ({MAX_BOARD_SIZE} partnere). Fjern eller udskift en partner i stedet.</p>
      ) : outside.length === 0 ? (
        <p className="body">Alle partnere i kataloget sidder allerede på boardet.</p>
      ) : (
        <BoardActionForm action={actions.add} submitLabel="Tilføj">
          <input type="hidden" name="board_id" value={board.id} />
          <Select name="partner" label="Partner" defaultValue="">
            <option value="" disabled>
              Vælg partner
            </option>
            {outside.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name} ({partner.isInternal ? "intern" : "ekstern"})
              </option>
            ))}
          </Select>
        </BoardActionForm>
      )}

      <h2 className="heading-3 heading--on-light">Ejerens behov og dækning</h2>
      {coverage === null ? (
        <p className="form__notice" role="alert">
          Ejerens behov kunne ikke læses.
        </p>
      ) : coverage.needs.length === 0 ? (
        <p className="body">Ejeren har ikke angivet kompetencebehov (quizzen er ikke besvaret).</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="table__head">Behov</th>
                <th className="table__head">Dækkes af</th>
              </tr>
            </thead>
            <tbody>
              {coverage.needs.map((need) => (
                <tr key={need.tagId} className="table__row">
                  <td className="table__cell">{tagLabels[need.tagId] ?? need.tagId}</td>
                  <td className="table__cell">
                    {need.coveredBy.length > 0 ? need.coveredBy.map((c) => c.name).join(", ") : "Ikke dækket"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="heading-3 heading--on-light">Cal.com</h2>
      <p className="body">
        Event type: {board.calcomEventTypeId != null ? board.calcomEventTypeId : "ikke oprettet"}
      </p>
      {board.hostsOutOfSync ? (
        <p className="form__notice" role="alert">
          Cal.com-hosts ikke opdateret — kør Opdatér hosts. Event typens værter svarer ikke til boardets nuværende
          partnere.
        </p>
      ) : null}
      {withoutSeat.length > 0 ? (
        <p className="form__notice" role="status">
          Mangler Cal.com-bruger-id: {withoutSeat.join(", ")}
        </p>
      ) : null}
      <AuthForm
        action={actions.syncHosts}
        submitLabel={
          board.calcomEventTypeId != null ? "Opdatér hosts på Cal.com-event type" : "Opret Cal.com-event type"
        }
      >
        <input type="hidden" name="board_id" value={board.id} />
      </AuthForm>

      <h2 className="heading-3 heading--on-light">Seneste ændringer</h2>
      {board.changes.length === 0 ? (
        <p className="body">Ingen ændringer registreret endnu.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="table__head">Tidspunkt</th>
                <th className="table__head">Ændring</th>
                <th className="table__head">Cal.com-hosts</th>
              </tr>
            </thead>
            <tbody>
              {board.changes.map((change) => (
                <tr key={change.id} className="table__row">
                  <td className="table__cell">
                    {new Date(change.createdAt).toLocaleString("da-DK", {
                      timeZone: "Europe/Copenhagen",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="table__cell">{describeBoardChange(change, nameOf)}</td>
                  <td className="table__cell">{SYNC_LABEL[change.calcomSync]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
