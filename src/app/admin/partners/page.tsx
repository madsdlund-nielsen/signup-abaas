import Link from "next/link";
import type { Metadata } from "next";
import { listPartners } from "@/server/partners";
import { createPartner, deletePartner } from "@/server/partners/actions";
import { Field } from "@/components/Field";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Partner-katalog — Admin" };

// Læser session-afhængige data (RLS) — dynamisk.
export const dynamic = "force-dynamic";

export default async function AdminPartnersPage() {
  const partners = await listPartners();

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> · Partner-katalog
      </p>
      <h1 className="heading-2 heading--on-light">Partner-katalog</h1>
      <p className="body">
        Admin forfatter kataloget og tildeler kompetence-tags autoritativt. Partnere kan ikke
        redigere egne tags. Fulde profilfelter redigeres pr. partner.
      </p>

      <form className="form measure" action={createPartner}>
        <Field name="name" label="Navn" required />
        <Field name="title" label="Titel/rolle" />
        <div className="field">
          <label className="field__label" htmlFor="is_internal">
            Intern partner (fast)
          </label>
          <input type="checkbox" name="is_internal" id="is_internal" defaultChecked />
        </div>
        <Field name="sort_order" label="Sortering" type="number" defaultValue={partners.length + 1} />
        <PrimaryButton type="submit">Opret partner</PrimaryButton>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th className="table__head">Navn</th>
            <th className="table__head">Titel</th>
            <th className="table__head">Type</th>
            <th className="table__head">Handling</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => (
            <tr key={partner.id} className="table__row">
              <td className="table__cell">{partner.name}</td>
              <td className="table__cell">{partner.title ?? "—"}</td>
              <td className="table__cell">{partner.isInternal ? "Intern" : "Ekstern"}</td>
              <td className="table__cell">
                <span className="row-form">
                  <Link className="btn-secondary" href={`/admin/partners/${partner.id}`}>
                    Redigér
                  </Link>
                  <form action={deletePartner}>
                    <input type="hidden" name="id" value={partner.id} />
                    <button className="btn-secondary" type="submit">
                      Slet
                    </button>
                  </form>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
