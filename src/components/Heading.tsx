import type { ReactNode } from "react";

export type HeadingLevel = 1 | 2 | 3;

const TAGS = { 1: "h1", 2: "h2", 3: "h3" } as const;

/**
 * Overskrift i token-typeskalaen. Tynde vægte (aldrig fede). `onDark` skifter
 * farve til hvid på mørke bånd, ellers navy.
 */
export function Heading({
  level = 2,
  onDark = false,
  children,
}: {
  level?: HeadingLevel;
  onDark?: boolean;
  children: ReactNode;
}) {
  const Tag = TAGS[level];
  return (
    <Tag className={`heading-${level} heading--${onDark ? "on-dark" : "on-light"}`}>
      {children}
    </Tag>
  );
}
