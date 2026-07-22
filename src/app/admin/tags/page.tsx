import Link from "next/link";
import type { Metadata } from "next";
import { listTags } from "@/server/tags";
import { createTagAction, deleteTagAction, updateTagAction } from "@/server/tags/actions";
import { Field } from "@/components/Field";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Kompetence-tags — Admin" };

// Læser session-afhængige data (RLS) — dynamisk.
export const dynamic = "force-dynamic";

export default async function AdminTagsPage() {
  const tags = await listTags();

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> · Kompetence-tags
      </p>
      <h1 className="heading-2 heading--on-light">Kompetence-tags</h1>
      <p className="body">
        Admin ejer taksonomien. Slug genereres automatisk fra label. Partnere kan ikke redigere tags.
      </p>

      <form className="form measure" action={createTagAction}>
        <Field name="label" label="Ny tag (label)" required />
        <Field name="sort_order" label="Sortering" type="number" defaultValue={tags.length + 1} />
        <PrimaryButton type="submit">Opret tag</PrimaryButton>
      </form>

      <table className="table">
        <thead>
          <tr>
            <th className="table__head">Label · sortering</th>
            <th className="table__head">Slug</th>
            <th className="table__head">Handling</th>
          </tr>
        </thead>
        <tbody>
          {tags.map((tag) => (
            <tr key={tag.id} className="table__row">
              <td className="table__cell">
                <form className="row-form" action={updateTagAction}>
                  <input type="hidden" name="id" value={tag.id} />
                  <input
                    className="field__input"
                    name="label"
                    defaultValue={tag.label}
                    aria-label="Label"
                    required
                  />
                  <input
                    className="field__input"
                    name="sort_order"
                    type="number"
                    defaultValue={tag.sortOrder}
                    aria-label="Sortering"
                  />
                  <button className="btn-secondary" type="submit">
                    Gem
                  </button>
                </form>
              </td>
              <td className="table__cell">{tag.slug}</td>
              <td className="table__cell">
                <form action={deleteTagAction}>
                  <input type="hidden" name="id" value={tag.id} />
                  <button className="btn-secondary" type="submit">
                    Slet
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
