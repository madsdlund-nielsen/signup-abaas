import type { PostHog } from "posthog-js";

import { POSTHOG_BROWSER_HOST, POSTHOG_UI_HOST } from "./browser-config";
import { sanitizeEvent, sanitizePath } from "./browser-sanitize";

/**
 * Browser-adapteren til PostHog (ADR 0072). Den ENESTE fil der kender `posthog-js`.
 *
 * Princippet er «intet før samtykke»: SDK'et hentes først (dynamisk `import()`) og initialiseres
 * først når `startBrowserAnalytics` kaldes — og det sker kun efter et aktivt `analytics`-valg.
 * Før det findes hverken SDK-kode i siden, cookies, localStorage eller netværkskald til PostHog.
 *
 * Konfigurationen vælger overalt det mest privatlivsvenlige:
 *  - `autocapture: false` — ingen klik-, formular- eller tekstopsamling. Autocapture med maskering
 *    (`mask_all_text`) ville stadig sende elementstier og klik; vi har ikke brug for dem til
 *    «anonym brugsstatistik», så den mest privatlivsvenlige mulighed er slet ikke at opsamle.
 *  - Sidevisninger sendes manuelt (App Router skifter side uden sideindlæsning) med en renset adresse.
 *  - Ingen session recording, surveys, heatmaps, dead clicks, exception capture eller feature flags,
 *    og `disable_external_dependency_loading`: SDK'et henter aldrig yderligere scripts fra CDN.
 *  - `person_profiles: "identified_only"` og vi kalder aldrig `identify` — ingen personprofiler.
 */

interface Running {
  posthog: PostHog;
}

let running: Running | null = null;
let starting: Promise<Running | null> | null = null;
/** Hvad der SENEST er bedt om. Gør start/stop-kapløb harmløse (se `startBrowserAnalytics`). */
let wanted = false;

const PH_STORAGE_PREFIXES = ["ph_", "__ph_"];

/**
 * Fjerner alt PostHog har skrevet i browseren: cookies (`ph_<nøgle>_posthog`), localStorage og
 * sessionStorage. Kan kaldes uden at SDK'et er hentet — så rydder vi også rester efter et
 * tidligere samtykke der er udløbet eller trukket tilbage.
 */
export function clearPostHogStorage(): void {
  if (typeof document === "undefined") return;
  try {
    for (const part of document.cookie.split(";")) {
      const name = part.split("=")[0]?.trim();
      if (name && PH_STORAGE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
        document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      }
    }
  } catch {
    // cookies utilgængelige — intet at rydde
  }
  for (const storage of [safeStorage("localStorage"), safeStorage("sessionStorage")]) {
    if (!storage) continue;
    try {
      for (const key of Object.keys(storage)) {
        if (PH_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) storage.removeItem(key);
      }
    } catch {
      // storage blokeret — intet at rydde
    }
  }
}

function safeStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

/** Initialisér (én gang) og slå indsamling til. KUN efter `analytics`-samtykke. */
export async function startBrowserAnalytics(apiKey: string): Promise<boolean> {
  wanted = true;
  if (running) {
    running.posthog.opt_in_capturing();
    return true;
  }
  starting ??= (async () => {
    const { default: posthog } = await import("posthog-js");
    // Samtykket kan være trukket tilbage mens SDK'et blev hentet — så initialiseres det aldrig.
    if (!wanted) return null;
    posthog.init(apiKey, {
      api_host: POSTHOG_BROWSER_HOST,
      ui_host: POSTHOG_UI_HOST,
      persistence: "localStorage+cookie",
      cross_subdomain_cookie: false,
      secure_cookie: window.location.protocol === "https:",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      save_referrer: false,
      respect_dnt: true,
      before_send: (event) => sanitizeEvent(event),
    });
    running = { posthog };
    return running;
  })().finally(() => {
    starting = null;
  });
  return (await starting) !== null;
}

/**
 * Sidevisning (App Router skifter side uden sideindlæsning). Sender kun hvis der er givet
 * samtykke og SDK'et kører; kaldes stadig mens det hentes, venter den på det.
 */
export async function captureBrowserPageview(pathname: string): Promise<void> {
  if (!wanted) return;
  const ready = running ?? (await starting);
  if (!wanted || !ready) return;
  const path = sanitizePath(pathname);
  ready.posthog.capture("$pageview", { $current_url: `${window.location.origin}${path}`, $pathname: path });
}

/**
 * Samtykket er trukket tilbage (eller aldrig givet): stop indsamling og ryd alt. Sikkert at
 * kalde uden at SDK'et nogensinde er hentet — så rydder den kun rester.
 */
export function stopBrowserAnalytics(): void {
  wanted = false;
  if (running) {
    running.posthog.opt_out_capturing();
    running.posthog.reset();
  }
  clearPostHogStorage();
}
