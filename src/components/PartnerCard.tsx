import type { ReactNode } from "react";

/**
 * Profilkort til board-anbefalingen (fase 1.6): foto, navn, titel, kompetence-tags, kort bio.
 * Modsat `Card` (foto-fyldt med overlay-titel) er dette redaktionelt — teksten står under billedet,
 * og `children` er en fodslot til udskift-formen.
 *
 * `photoUrl` er datadrevet indhold (ikke en design-token) og sættes derfor via inline
 * background-image — samme præcedens som `Card`. Al øvrig styling kommer fra token-klasser.
 */

export interface PartnerCardPartner {
  id: string;
  name: string;
  title: string | null;
  photoUrl: string | null;
  shortBio: string | null;
  competenceTagIds: string[];
}

export function PartnerCard({
  partner,
  tagLabels,
  wantedTagIds,
  isLead = false,
  showLead = false,
  children,
}: {
  partner: PartnerCardPartner;
  /** competence_tag.id → label. */
  tagLabels: Map<string, string>;
  /** Ejerens ønskede tags — fremhæves som match. */
  wantedTagIds: readonly string[];
  isLead?: boolean;
  /** Lead-markering er bag feature-flag (tildelingsregler uafklaret). */
  showLead?: boolean;
  children?: ReactNode;
}) {
  const wanted = new Set(wantedTagIds);

  return (
    <article className="partner-card">
      <div
        className="partner-card__media"
        style={partner.photoUrl ? { backgroundImage: `url(${partner.photoUrl})` } : undefined}
      />
      <div className="partner-card__body">
        {showLead && isLead ? <p className="partner-card__lead">Lead-partner</p> : null}
        <h3 className="heading-3 heading--on-light">{partner.name}</h3>
        {partner.title ? <p className="body">{partner.title}</p> : null}
        {partner.competenceTagIds.length > 0 ? (
          <ul className="partner-card__tags">
            {partner.competenceTagIds.map((tagId) => (
              <li
                key={tagId}
                className={wanted.has(tagId) ? "partner-tag partner-tag--match" : "partner-tag"}
              >
                {tagLabels.get(tagId) ?? "Ukendt kompetence"}
              </li>
            ))}
          </ul>
        ) : null}
        {partner.shortBio ? <p className="body">{partner.shortBio}</p> : null}
      </div>
      {children ? <div className="partner-card__footer">{children}</div> : null}
    </article>
  );
}
