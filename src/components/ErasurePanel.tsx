"use client";

import { useActionState } from "react";

import { ErasureReceiptPanel } from "@/components/ErasureReceipts";
import { Field } from "@/components/Field";
import { PrimaryButton } from "@/components/PrimaryButton";
import type { ErasureConfirmState, ErasurePreviewState } from "@/server/erasure/actions";
import type { ErasurePlan } from "@/server/erasure/plan";

/**
 * Sletning (GDPR art. 17, ADR 0068) på /admin/juridisk — to trin: «Slå op» viser planen (slettes /
 * blokeret / eksterne behandlere), og først derefter kan den bekræftes ved at skrive e-mailen igen.
 * Er planen blokeret, findes der ingen bekræftelsesformular overhovedet. Server-actions kommer som
 * props, så komponenten kan testes uden Supabase. Al styling via token-klasser.
 *
 * Planen indeholder ingen e-mail og intet telefonnummer; kun navnet på kontoen (hvis der er et), så
 * admin kan se at det er den rigtige person.
 */

export type PreviewAction = (prev: ErasurePreviewState, formData: FormData) => Promise<ErasurePreviewState>;
export type ConfirmAction = (prev: ErasureConfirmState, formData: FormData) => Promise<ErasureConfirmState>;

const ROLE_LABEL: Record<string, string> = {
  ejer: "Ejer",
  partner: "Partner",
  lead_partner: "Lead-partner",
  admin: "Admin",
};

export function ErasurePlanView({ plan }: { plan: ErasurePlan }) {
  return (
    <div className="panel panel--flat stack">
      <p className="eyebrow">Plan — intet er slettet endnu</p>
      <p className="factline">
        <span>{plan.displayName ?? "Konto uden navn"}</span>
        <span>{plan.roles.length > 0 ? plan.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ") : "Ingen roller"}</span>
        {plan.hasPartnerProfile ? <span>Har partnerprofil</span> : null}
      </p>

      {plan.blockers.length > 0 ? (
        <div className="stack" role="alert">
          <p className="eyebrow">Blokeret</p>
          {plan.blockers.map((blocker) => (
            <div key={blocker.code} className="stack">
              <p className="form__notice">{blocker.message}</p>
              {blocker.boards ? (
                <ul className="summary-actions">
                  {blocker.boards.map((board) => (
                    <li key={board.id} className="body">
                      {board.name}: {board.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
          <p className="body">Intet kan slettes, før blokeringen er løst. Der er ikke skrevet noget.</p>
        </div>
      ) : null}

      <div className="stack">
        <p className="eyebrow">I Supabase</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="table__head">Hvad</th>
                <th className="table__head table__head--num">Antal</th>
                <th className="table__head">Handling</th>
              </tr>
            </thead>
            <tbody>
              {plan.deletions.map((d) => (
                <tr key={d.label} className="table__row">
                  <td className="table__cell">{d.label}</td>
                  <td className="table__cell table__cell--num">{d.count}</td>
                  <td className="table__cell">{d.kind === "slettes" ? "Slettes" : "Anonymiseres"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {plan.boardRemovals.length > 0 ? (
        <div className="stack">
          <p className="eyebrow">Boards partneren fjernes fra</p>
          <ul className="summary-actions">
            {plan.boardRemovals.map((r) => (
              <li key={r.boardId} className="body">
                {r.boardName} — {r.expectedPartnerIds.length} → {r.expectedPartnerIds.length - 1} partnere
                (revisionsspor skrives; Cal.com-hosts opdateres bagefter)
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="stack">
        <p className="eyebrow">Eksterne behandlere</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="table__head">Behandler</th>
                <th className="table__head">Automatisk</th>
                <th className="table__head">Manuelt</th>
              </tr>
            </thead>
            <tbody>
              {plan.externals.map((e) => (
                <tr key={e.processor} className="table__row">
                  <td className="table__cell">{e.label}</td>
                  <td className="table__cell">{e.automatic ?? "—"}</td>
                  <td className="table__cell">{e.manual ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="body">
          Fejler en behandler, står Supabase-sletningen fast og fejlen registreres på kvitteringen som
          «mangler». Betalings- og bogføringsdata hos Alunta, QuickPay, Nets og regnskabssystemet slettes
          aldrig af flowet.
        </p>
      </div>
    </div>
  );
}

export function ErasurePanel({
  previewAction,
  confirmAction,
}: {
  previewAction: PreviewAction;
  confirmAction: ConfirmAction;
}) {
  const [preview, previewForm, previewPending] = useActionState<ErasurePreviewState, FormData>(previewAction, {});
  const [confirm, confirmForm, confirmPending] = useActionState<ErasureConfirmState, FormData>(confirmAction, {});

  const receipt = confirm.receipt;
  const plan = receipt ? undefined : preview.plan;

  return (
    <div className="stack">
      <p className="eyebrow">Sletning (GDPR art. 17)</p>
      <p className="body measure">
        Slet en person og alt der hænger på vedkommende i Supabase, og giv de eksterne behandlere besked.
        Sletningen er endelig. Først slås personen op og planen vises; først derefter bekræftes den ved at
        skrive e-mailadressen igen. Personer med betalingsdata kan ikke slettes her: opbevaringspligt er
        ikke afklaret (TODO(ejer/jura)).
      </p>

      <form className="form measure" action={previewForm}>
        <Field name="email" label="E-mail på personen" type="email" required autoComplete="off" />
        <PrimaryButton type="submit" disabled={previewPending}>
          Slå op og vis plan
        </PrimaryButton>
      </form>
      {preview.error ? (
        <p className="form__notice" role="alert">
          {preview.error}
        </p>
      ) : null}

      {plan ? <ErasurePlanView plan={plan} /> : null}

      {plan && plan.executable ? (
        <form className="form measure" action={confirmForm}>
          <input type="hidden" name="user_id" value={plan.userId} />
          <Field name="confirm_email" label="Skriv e-mailen igen for at bekræfte" type="email" required autoComplete="off" />
          <PrimaryButton type="submit" disabled={confirmPending}>
            Slet permanent
          </PrimaryButton>
        </form>
      ) : null}
      {confirm.error ? (
        <p className="form__notice" role="alert">
          {confirm.error}
        </p>
      ) : null}

      {receipt ? <ErasureReceiptPanel receipt={receipt} /> : null}
    </div>
  );
}
