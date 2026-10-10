import Link from "next/link";
import type { Metadata } from "next";

import { AuthForm } from "@/components/AuthForm";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { listAdminBoards } from "@/server/boards";
import { createBoardEventType } from "@/server/meetings/booking-admin";

export const metadata: Metadata = { title: "Boards — Admin" };
export const dynamic = "force-dynamic";

/**
 * Cal.com-koblingen pr. board (ADR 0046, B-23): ét collective event type pr. board, med
 * partnernes Cal.com-sæder som værter. Rolle-guarden ligger i /admin/layout.tsx.
 */
export default async function AdminBoardsPage() {
  const boards = await listAdminBoards();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Boards
          </>
        }
        title="Boards"
        lead="Et board bookes mod sit eget collective event type hos Cal.com. Det oprettes her, når alle boardets partnere har et Cal.com-bruger-id (sættes på partnerens side)."
      />
      <PageBody>
        {boards.length === 0 ? (
          <p className="body">Ingen boards endnu.</p>
        ) : (
          <div className="panel-grid">
            {boards.map((board) => {
              const missing = board.partners.filter((p) => !p.hasCalcomUser).map((p) => p.name);
              return (
                <div key={board.id} className="panel">
                  <h2 className="heading-3 heading--on-light">{board.name}</h2>
                  <p className="body">
                    Event type:{" "}
                    {board.calcomEventTypeId != null ? board.calcomEventTypeId : "ikke oprettet"}
                  </p>
                  <p className="body">
                    Partnere:{" "}
                    {board.partners.length === 0 ? "ingen" : board.partners.map((p) => p.name).join(", ")}
                  </p>
                  {missing.length > 0 ? (
                    <p className="form__notice" role="status">
                      Mangler Cal.com-bruger-id: {missing.join(", ")}
                    </p>
                  ) : null}
                  <AuthForm
                    action={createBoardEventType}
                    submitLabel={
                      board.calcomEventTypeId != null
                        ? "Opdatér hosts på Cal.com-event type"
                        : "Opret Cal.com-event type"
                    }
                  >
                    <input type="hidden" name="board_id" value={board.id} />
                  </AuthForm>
                </div>
              );
            })}
          </div>
        )}
      </PageBody>
    </>
  );
}
