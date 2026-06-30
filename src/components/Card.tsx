/**
 * Foto-fyldt kort med mørkt navy-overlay og versal hvid titel ved bunden.
 * Firkantet (--radius: 0). `imageUrl` er datadrevet indhold (ikke en design-token),
 * så den sættes via en inline background-image; al styling kommer ellers fra tokens.
 */
export function Card({ title, imageUrl }: { title: string; imageUrl?: string }) {
  return (
    <article className="card">
      <div
        className="card__media"
        style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
      />
      <div className="card__overlay" />
      <h3 className="card__title">{title}</h3>
    </article>
  );
}
