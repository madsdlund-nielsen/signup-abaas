"use client";

import { useActionState, useState } from "react";
import { PriceBreakdown } from "@/components/PriceBreakdown";
import { PrimaryButton } from "@/components/PrimaryButton";
import type { AuthFormState } from "@/components/AuthForm";
import type { FrequencyWeeks, PricingRuleInput } from "@/server/pricing/algorithm";

/**
 * Opret prisregel-version med PREVIEW INDEN GEM (ADR 0017-mønstret): de controlled felter
 * BEVARER deres name, så FormData er uændret for server-actionen, og preview'et renderer
 * den SAMME PriceBreakdown som ejeren møder — fodret med live-state. Intet gemmes før submit.
 * Værdierne kommer fra admins indtastning; formularen har ingen defaults (stub-politik).
 */

type CreateAction = (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;

const FREQUENCIES: FrequencyWeeks[] = [4, 8, 12];

export function PricingRuleForm({ action, nextVersion }: { action: CreateAction; nextVersion: number }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(action, {});
  const [baseAmount, setBaseAmount] = useState("");
  const [perPartner, setPerPartner] = useState("");
  const [factor4, setFactor4] = useState("");
  const [factor8, setFactor8] = useState("");
  const [factor12, setFactor12] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const previewRule: PricingRuleInput | null = (() => {
    const rule = {
      id: "preview",
      version: nextVersion,
      baseAmountMinor: Number(baseAmount),
      perPartnerAmountMinor: Number(perPartner),
      factor4Weeks: Number(factor4),
      factor8Weeks: Number(factor8),
      factor12Weeks: Number(factor12),
      currency: "DKK",
    };
    const valid =
      Number.isInteger(rule.baseAmountMinor) &&
      rule.baseAmountMinor >= 0 &&
      Number.isInteger(rule.perPartnerAmountMinor) &&
      rule.perPartnerAmountMinor >= 0 &&
      [rule.factor4Weeks, rule.factor8Weeks, rule.factor12Weeks].every(
        (f) => Number.isFinite(f) && f > 0,
      );
    return valid ? rule : null;
  })();

  return (
    <div className="stack">
      <form className="form measure" action={formAction}>
        <div className="field">
          <label className="field__label" htmlFor="base_amount_minor">
            Grundpris pr. møde (øre)
          </label>
          <input
            className="field__input"
            id="base_amount_minor"
            name="base_amount_minor"
            type="number"
            min={0}
            step={1}
            required
            value={baseAmount}
            onChange={(event) => setBaseAmount(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="per_partner_amount_minor">
            Pris pr. partner pr. møde (øre)
          </label>
          <input
            className="field__input"
            id="per_partner_amount_minor"
            name="per_partner_amount_minor"
            type="number"
            min={0}
            step={1}
            required
            value={perPartner}
            onChange={(event) => setPerPartner(event.target.value)}
          />
        </div>
        {(
          [
            ["factor_4_weeks", "Faktor — hver 4. uge", factor4, setFactor4],
            ["factor_8_weeks", "Faktor — hver 8. uge", factor8, setFactor8],
            ["factor_12_weeks", "Faktor — hver 12. uge", factor12, setFactor12],
          ] as const
        ).map(([name, label, value, setValue]) => (
          <div className="field" key={name}>
            <label className="field__label" htmlFor={name}>
              {label}
            </label>
            <input
              className="field__input"
              id={name}
              name={name}
              type="number"
              min={0}
              step="0.0001"
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
        ))}
        {state.error ? (
          <p className="form__notice" role="alert">
            {state.error}
          </p>
        ) : null}
        <PrimaryButton type="submit" disabled={pending}>
          {pending ? "Gemmer…" : `Gem som version ${nextVersion}`}
        </PrimaryButton>
      </form>

      <button
        className="btn-secondary"
        type="button"
        aria-expanded={showPreview}
        onClick={() => setShowPreview((value) => !value)}
      >
        {showPreview ? "Skjul preview" : "Vis preview (inden gem)"}
      </button>

      {showPreview ? (
        previewRule ? (
          <div className="card-grid">
            {[2, 3].flatMap((partnerCount) =>
              FREQUENCIES.map((frequencyWeeks) => (
                <div className="stack" key={`${partnerCount}-${frequencyWeeks}`}>
                  <h3 className="heading-3 heading--on-light">
                    {partnerCount} partnere · hver {frequencyWeeks}. uge
                  </h3>
                  <PriceBreakdown
                    rule={previewRule}
                    partnerCount={partnerCount}
                    frequencyWeeks={frequencyWeeks}
                  />
                </div>
              )),
            )}
          </div>
        ) : (
          <p className="form__notice" role="status">
            Udfyld alle felter med gyldige værdier for at se preview.
          </p>
        )
      ) : null}
    </div>
  );
}
