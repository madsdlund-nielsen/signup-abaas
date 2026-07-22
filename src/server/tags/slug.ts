/**
 * Slug fra en label. Ren funktion (ingen SDK/next-import), så den kan enhedstestes isoleret.
 * Danske tegn translittereres (æ→ae, ø→oe, å→aa) før ikke-alfanumeriske erstattes med bindestreg.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
