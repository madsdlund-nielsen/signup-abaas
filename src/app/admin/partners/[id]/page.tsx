import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPartner } from "@/server/partners";
import { setPartnerTags, updatePartner } from "@/server/partners/actions";
import { listTags } from "@/server/tags";
import { Field } from "@/components/Field";
import { TextArea } from "@/components/TextArea";
import { Checkbox } from "@/components/Checkbox";
import { PrimaryButton } from "@/components/PrimaryButton";

export const metadata: Metadata = { title: "Redigér partner — Admin" };
export const dynamic = "force-dynamic";

export default async function AdminPartnerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [partner, tags] = await Promise.all([getPartner(id), listTags()]);
  if (!partner) notFound();

  return (
    <main className="container stack">
      <p className="eyebrow">
        <Link href="/admin">Admin</Link> · <Link href="/admin/partners">Partner-katalog</Link> · Redigér
      </p>
      <h1 className="heading-2 heading--on-light">Redigér partner</h1>

      <form className="form measure" action={updatePartner}>
        <input type="hidden" name="id" value={partner.id} />
        <Field name="name" label="Navn" defaultValue={partner.name} required />
        <Field name="title" label="Titel/rolle" defaultValue={partner.title ?? undefined} />
        <div className="field">
          <label className="field__label" htmlFor="is_internal">
            Intern partner (fast)
          </label>
          <input
            type="checkbox"
            name="is_internal"
            id="is_internal"
            defaultChecked={partner.isInternal}
          />
        </div>
        <Field name="languages" label="Sprog" defaultValue={partner.languages ?? undefined} />
        <Field name="photo_url" label="Billede-URL" defaultValue={partner.photoUrl ?? undefined} />
        <TextArea
          name="personal_info"
          label="Personlig info"
          defaultValue={partner.personalInfo ?? undefined}
        />
        <TextArea name="short_bio" label="Kort bio" defaultValue={partner.shortBio ?? undefined} />
        <TextArea name="long_bio" label="Lang bio" defaultValue={partner.longBio ?? undefined} />
        <Field name="sort_order" label="Sortering" type="number" defaultValue={partner.sortOrder} />
        <PrimaryButton type="submit">Gem</PrimaryButton>
      </form>

      <h2 className="heading-3 heading--on-light">Kompetence-tags</h2>
      <p className="body">Admin tildeler tags autoritativt — partneren kan ikke ændre dem.</p>
      <form className="form measure" action={setPartnerTags}>
        <input type="hidden" name="partner_id" value={partner.id} />
        {tags.length === 0 ? (
          <p className="body">Ingen kompetence-tags oprettet endnu.</p>
        ) : (
          <div className="checkbox-group">
            {tags.map((tag) => (
              <Checkbox
                key={tag.id}
                name="tag"
                value={tag.id}
                label={tag.label}
                defaultChecked={partner.competenceTagIds.includes(tag.id)}
              />
            ))}
          </div>
        )}
        <PrimaryButton type="submit">Gem tags</PrimaryButton>
      </form>
    </main>
  );
}
