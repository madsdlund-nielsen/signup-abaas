import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { AdminBoardEditor } from "@/components/AdminBoards";
import { PageBody, PageHeader } from "@/components/PageHeader";
import { getAdminBoardDetail } from "@/server/boards/admin";
import {
  adminAddBoardPartner,
  adminRemoveBoardPartner,
  adminSetBoardLead,
  adminSwapBoardPartner,
} from "@/server/boards/admin-actions";
import { isEnabled } from "@/server/flags";
import { createBoardEventType } from "@/server/meetings/booking-admin";
import { listTags } from "@/server/tags";

export const metadata: Metadata = { title: "Redigér board — Admin" };
export const dynamic = "force-dynamic";

/**
 * Editoren for ét board (ADR 0062): medlemmer, lead, kompetencedækning mod ejerens behov,
 * kandidat-delta ved udskift og Cal.com-hosts. Rolle-guarden ligger i /admin/layout.tsx, og
 * læsningen kræver rollen igen.
 */
export default async function AdminBoardEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ udskift?: string; skiftet?: string; fra?: string }>;
}) {
  const { id } = await params;
  const { udskift, skiftet, fra } = await searchParams;
  const [board, tags] = await Promise.all([getAdminBoardDetail(id), listTags()]);
  if (!board) notFound();

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/admin">Admin</Link> · <Link href="/admin/boards">Boards</Link> · Redigér
          </>
        }
        title={board.name}
        lead="Sammensætningen følger de samme regler som ejerens egen: 2-3 partnere, mindst én intern, og lead er altid intern. Hver ændring opdaterer boardets Cal.com-hosts og logges."
      />
      <PageBody>
        <AdminBoardEditor
          board={board}
          tagLabels={Object.fromEntries(tags.map((tag) => [tag.id, tag.label]))}
          // TODO(ejer): lead-partner regler — manuel markering bag flaget, som på ejerens side.
          showLead={isEnabled("leadPartner")}
          swapOutgoingId={udskift ?? null}
          swapped={skiftet && fra ? { incomingId: skiftet, outgoingId: fra } : null}
          actions={{
            add: adminAddBoardPartner,
            remove: adminRemoveBoardPartner,
            swap: adminSwapBoardPartner,
            setLead: adminSetBoardLead,
            syncHosts: createBoardEventType,
          }}
        />
      </PageBody>
    </>
  );
}
