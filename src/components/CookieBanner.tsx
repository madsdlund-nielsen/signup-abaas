"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import {
  CONSENT_CHANGED_EVENT,
  CONSENT_OPEN_EVENT,
  buildConsentCookie,
  type ConsentState,
} from "@/server/consent";
import { Checkbox } from "./Checkbox";

interface CookieBannerProps {
  /** Det gemte valg (fra cookien på request-tidspunktet); `null` = endnu ikke valgt. */
  initial: ConsentState | null;
}

/**
 * Cookie-banneret (ADR 0072). Renderes KUN af rodlayoutet når browser-analytics er slået til
 * (`FLAG_ANALYTICS` + `NEXT_PUBLIC_POSTHOG_KEY`) — ellers er der intet at spørge om.
 *
 * Principper:
 *  - Ligeværdige valg: «Kun nødvendige» og «Tillad analyse» er samme knap-type, samme vægt og
 *    samme størrelse. Ingen af dem er guld, ingen er forhåndsvalgt (ingen dark patterns).
 *  - Ikke en modal: banneret ligger nederst, blokerer ikke siden og fanger ikke fokus. Det står
 *    tidligt i DOM-rækkefølgen (lige efter «Spring til indhold»), så tastaturbrugere når det.
 *  - Genåbnes fra footerens «Cookie-indstillinger» (CONSENT_OPEN_EVENT), og fokus går tilbage
 *    til det element der åbnede det, når det lukkes.
 *
 * Kategorierne er dem der FAKTISK sætter noget i dag: nødvendige og analyse. `functional` findes
 * i samtykkekernen, men intet bruger den endnu, så den vises ikke (en tom kategori at sige ja til
 * er støj). Kommer der en funktionel cookie, tilføjes kategorien her og i docs/gdpr/cookies.md.
 *
 * TODO(ejer): samtykketekst — godkendes sammen med ToS (stub-register). Teksten er neutral og
 * faktuel og lover intet juridisk.
 */
export function CookieBanner({ initial }: CookieBannerProps) {
  const [choice, setChoice] = useState<ConsentState | null>(initial);
  const [open, setOpen] = useState(initial === null);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(initial?.analytics ?? false);
  const [announcement, setAnnouncement] = useState("");
  const titleRef = useRef<HTMLParagraphElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const focusTitle = useRef(false);
  const choiceRef = useRef(choice);

  useEffect(() => {
    choiceRef.current = choice;
  }, [choice]);

  // Footerens «Cookie-indstillinger» beder banneret åbne igen, med indstillingerne fremme.
  useEffect(() => {
    const onOpen = () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setAnalytics(choiceRef.current?.analytics ?? false);
      setSettings(true);
      setOpen(true);
      focusTitle.current = true;
    };
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
  }, []);

  // Fokus flyttes kun når besøgende selv har bedt om at åbne — aldrig ved første indlæsning.
  useEffect(() => {
    if (open && focusTitle.current) {
      focusTitle.current = false;
      titleRef.current?.focus();
    }
  }, [open]);

  function save(allowAnalytics: boolean) {
    const next: ConsentState = { necessary: true, functional: false, analytics: allowAnalytics };
    try {
      document.cookie = buildConsentCookie(next, { secure: window.location.protocol === "https:" });
    } catch {
      // Cookies blokeret: valget gælder i denne session, men kan ikke huskes.
    }
    setChoice(next);
    setAnalytics(allowAnalytics);
    setSettings(false);
    setOpen(false);
    setAnnouncement(allowAnalytics ? "Dit valg er gemt: analyse er tilladt." : "Dit valg er gemt: kun nødvendige cookies.");
    window.dispatchEvent(new CustomEvent<ConsentState>(CONSENT_CHANGED_EVENT, { detail: next }));
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }

  function dismiss() {
    // Lukker uden at ændre noget — kun muligt når der allerede ligger et valg.
    setSettings(false);
    setOpen(false);
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (settings) {
      event.stopPropagation();
      setSettings(false);
      settingsButtonRef.current?.focus();
    } else if (choice !== null) {
      dismiss();
    }
  }

  return (
    <>
      <p className="visually-hidden" role="status">
        {announcement}
      </p>
      {open && (
        <div
          className="cookiebanner"
          role="region"
          aria-labelledby="cookiebanner-title"
          onKeyDown={onKeyDown}
        >
          <div className="cookiebanner__inner">
            <p className="cookiebanner__title" id="cookiebanner-title" tabIndex={-1} ref={titleRef}>
              Cookies
            </p>
            <p className="cookiebanner__text">
              Platformen bruger nødvendige cookies til login og sikker adgang. Hvis du tillader det,
              bruger vi også PostHog (EU) til brugsstatistik over sidevisninger, uden personprofiler,
              så vi kan forbedre platformen. Du kan ændre dit valg når som helst under
              «Cookie-indstillinger» nederst på siden.
            </p>
            {settings && (
              <fieldset className="cookiebanner__settings" id="cookiebanner-settings">
                <legend className="cookiebanner__legend">Vælg kategorier</legend>
                <div className="cookiebanner__option">
                  <Checkbox
                    name="cookie"
                    value="necessary"
                    label="Nødvendige"
                    checked
                    disabled
                    readOnly
                    aria-describedby="cookie-necessary-desc"
                  />
                  <p className="cookiebanner__desc" id="cookie-necessary-desc">
                    Login og session, adgangsport og din cookie-præference. Uden dem virker
                    platformen ikke, så de kan ikke fravælges.
                  </p>
                </div>
                <div className="cookiebanner__option">
                  <Checkbox
                    name="cookie"
                    value="analytics"
                    label="Analyse"
                    checked={analytics}
                    onChange={(event) => setAnalytics(event.target.checked)}
                    aria-describedby="cookie-analytics-desc"
                  />
                  <p className="cookiebanner__desc" id="cookie-analytics-desc">
                    PostHog (EU): sidevisninger og enhedstype, uden personprofiler. Sættes først
                    når du tillader det.
                  </p>
                </div>
              </fieldset>
            )}
            <div className="cookiebanner__actions">
              <button className="btn-secondary" type="button" onClick={() => save(false)}>
                Kun nødvendige
              </button>
              <button className="btn-secondary" type="button" onClick={() => save(true)}>
                Tillad analyse
              </button>
              <button
                className="btn-secondary"
                type="button"
                ref={settingsButtonRef}
                aria-expanded={settings}
                aria-controls="cookiebanner-settings"
                onClick={() => setSettings((value) => !value)}
              >
                Indstillinger
              </button>
              {settings && (
                <button className="btn-secondary" type="button" onClick={() => save(analytics)}>
                  Gem valg
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
