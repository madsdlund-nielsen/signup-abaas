/**
 * Demo-mærket (ADR 0041). Vises i headeren på HVER side når `FLAG_DEMO` er sat, og findes
 * ikke i DOM'en ellers — beslutningen ligger hos SiteHeader, som læser flaget server-side.
 * Komponenten selv er ren, så den kan testes.
 *
 * Dæmpet hvid, ikke guld: headerens CTA er det ene guld-element (ADR 0039), og et mærke
 * der sidder på alle sider må ikke bruge guldbudgettet.
 */
export function DemoBadge() {
  return (
    <span
      className="siteheader__demo"
      title="Demo-tilstand: booking, betaling, video og AI kører mod demo-implementeringer, ikke rigtige leverandører."
    >
      Demo
    </span>
  );
}
