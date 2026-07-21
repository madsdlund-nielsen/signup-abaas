import Link from "next/link";

export default function Home() {
  return (
    <main className="container">
      <p className="eyebrow">Advisory Board Unlimited</p>
      <h1 className="display">Et rådgivende board, sammensat til din virksomhed.</h1>
      <p className="lead">
        Fase 0 — fundament. Dette skelet etablerer design-tokens, adapter-laget for
        sub-processorer, feature-flags og RBAC/RLS, før der bygges features.
      </p>
      <Link className="btn-primary" href="/signup">
        Kom i gang
      </Link>
    </main>
  );
}
