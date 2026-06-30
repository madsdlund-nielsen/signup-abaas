// Ambient-deklarationer der ikke afhænger af Next's genererede next-env.d.ts,
// så `tsc --noEmit` (npm run check) kan køre uden et forudgående `next build`.
declare module "*.css";
