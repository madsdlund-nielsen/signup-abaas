import Link from "next/link";
import type { Metadata } from "next";

import { AdminBoardTable } from "@/components/AdminBoards";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { listAdminBoardOverviews } from "@/server/boards/admin";

export const metadata: Metadata = { title: "Boards — Admin" };
export const dynamic = "force-dynamic";

/**
 * Alle boards med ejer, partnere, møder og medlemskab (ADR 0062). Sammensætningen redigeres på
 * boardets egen side; Cal.com-koblingen (ADR 0046, B-23) sidder samme sted. Rolle-guarden ligger i
 * /admin/layout.tsx.
 */
export default async function AdminBoardsPage() {
  const boards = await listAdminBoardOverviews();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · Boards
          </>
        }
        title="Boards"
        lead="Admin styrer board-sammensætningen: tilføj, fjern og udskift partnere og sæt lead. Åbn et board for at redigere det og for at se dets Cal.com-hosts."
      />
      <PageBody>
        {boards.length === 0 ? <p className="body">Ingen boards endnu.</p> : <AdminBoardTable boards={boards} />}
      </PageBody>
    </>
  );
}
