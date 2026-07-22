import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin — Advisory Board Unlimited" };

export default function AdminHome() {
  return (
    <main className="container stack">
      <p className="eyebrow">Admin</p>
      <h1 className="heading-2 heading--on-light">Administration</h1>
      <ul className="admin-nav stack">
        <li>
          <Link href="/admin/tags">Kompetence-tags</Link>
        </li>
        <li>
          <Link href="/admin/quiz">Quiz</Link>
        </li>
        <li>
          <Link href="/admin/partners">Partner-katalog</Link>
        </li>
      </ul>
    </main>
  );
}
