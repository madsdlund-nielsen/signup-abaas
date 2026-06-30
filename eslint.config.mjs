import next from "eslint-config-next/core-web-vitals";

// Next.js 16 fjernede `next lint`; eslint-config-next leverer native flat config.
export default [
  { ignores: ["node_modules/**", ".next/**", "out/**", "coverage/**"] },
  ...next,
];
