import Link from "next/link";
import type { Metadata } from "next";

import { PageBody, PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Admin — Advisory Board Unlimited" };

/** Ét indgangspanel i admin-hubben. */
function AdminEntry({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <div className="panel">
      <h2 className="heading-3 heading--on-light">{title}</h2>
      <p className="body">{body}</p>
      <Link className="btn-secondary" href={href}>
        Åbn
      </Link>
    </div>
  );
}

export default function AdminHome() {
  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/dashboard">Dashboard</Link> · Admin
          </>
        }
        title="Administration"
        lead="Taksonomi, quiz, katalog og priser. Alt her er autoritativt: det ejere og partnere møder, forfattes på denne flade."
      />
      <PageBody>
        <div className="panel-grid">
          <AdminEntry
            title="Kompetence-tags"
            body="Taksonomien bag matchingen. Slug genereres fra label; partnere kan ikke redigere tags."
            href="/admin/tags"
          />
          <AdminEntry
            title="Quiz"
            body="Spørgsmål, svarmuligheder og deres kobling til kompetence-tags."
            href="/admin/quiz"
          />
          <AdminEntry
            title="Partner-katalog"
            body="Profiler, tags og invitationer til partner-login."
            href="/admin/partners"
          />
          <AdminEntry
            title="Prisregler"
            body="Versionerede satser. Uden en aktiv version kan der ikke beregnes en pris."
            href="/admin/priser"
          />
          <AdminEntry
            title="Vurderinger"
            body="Gennemsnit pr. rådgiver. Datagrundlag, ikke en offentlig score."
            href="/admin/vurderinger"
          />
        </div>
      </PageBody>
    </>
  );
}
