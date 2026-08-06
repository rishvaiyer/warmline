import { useState, useEffect } from "react";
import { EN, type UIStrings } from "./i18n/strings.js";

type Target = {
  id: string;
  venueName: string;
  phoneE164: string;
};

type Plan = {
  kind: string;
  fields: Record<string, unknown>;
  callGoal: string;
  disclosureLine: string;
  venueHint?: string;
  detectedLocale?: string;
};

// Locales whose script reads right-to-left; drives document.dir when the UI
// auto-localizes to whatever language the person typed their request in.
const RTL_LOCALE_PREFIXES = new Set(["ar", "he", "fa", "ur", "ps"]);

function isRtlLocale(locale: string): boolean {
  return RTL_LOCALE_PREFIXES.has(locale.split("-")[0].toLowerCase());
}

// The name of a language in its OWN language (endonym), e.g. "es" -> "Español",
// "vi" -> "Tiếng Việt" -- so the person reading the button recognizes it.
// Returns "" if we can't resolve a name.
function languageEndonym(locale: string): string {
  const lang = locale.split("-")[0].toLowerCase();
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(lang);
    if (!name || name.toLowerCase() === lang) return "";
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "";
  }
}

// "Loading…" written IN each supported language, shown on the overlay while the
// page is being switched -- so the wait itself already speaks their language.
const LOADING_MESSAGE_BY_LANG: Record<string, string> = {
  es: "Cargando…",
  zh: "加载中…",
  tl: "Naglo-load…",
  vi: "Đang tải…",
  ar: "جارٍ التحميل…",
  fr: "Chargement…",
  ko: "로딩 중…",
  ru: "Загрузка…",
  ht: "Ap chaje…",
  de: "Wird geladen…",
  hi: "लोड हो रहा है…",
  pt: "Carregando…",
  it: "Caricamento…",
  pl: "Ładowanie…",
  ur: "لوڈ ہو رہا ہے…",
  ja: "読み込み中…",
  fa: "در حال بارگذاری…",
  gu: "લોડ થઈ રહ્યું છે…",
  te: "లోడ్ అవుతోంది…",
  bn: "লোড হচ্ছে…",
  ta: "ஏற்றுகிறது…",
  pa: "ਲੋਡ ਹੋ ਰਿਹਾ ਹੈ…",
  el: "Φόρτωση…",
  km: "កំពុងផ្ទុក…",
  th: "กำลังโหลด…",
  hy: "Բեռնվում է…",
  am: "በመጫን ላይ…",
  so: "Waa la soo rarayaa…",
  uk: "Завантаження…"
};

function loadingMessageForLocale(locale: string): string {
  const lang = locale.split("-")[0].toLowerCase();
  return LOADING_MESSAGE_BY_LANG[lang] ?? "Loading…";
}

// Flatten the on-screen results into a short spoken script for the voice
// callback: venue, outcome, and any answer values (no raw field keys, which
// read badly out loud).
function buildCallbackSummary(results: CallResult[]): string {
  return results
    .map((result) => {
      const answers = Object.values(result.data)
        .map((value) => (Array.isArray(value) ? value.join(", ") : String(value ?? "")))
        .filter((text) => text.trim().length > 0);
      const parts = [`${result.venueName}: ${result.outcome}`, ...answers];
      if (result.followUpRequired && result.followUpInstructions.trim()) {
        parts.push(result.followUpInstructions.trim());
      }
      return parts.join(". ");
    })
    .join(" ");
}

type CallResult = {
  targetId: string;
  venueName: string;
  status: "completed" | "failed";
  outcome: string;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  followUpRequired: boolean;
  followUpInstructions: string;
  completedAt: string;
  data: Record<string, unknown>;
};

type RunResponse = {
  missionId: string;
  mode: string;
  results: CallResult[];
  // English copy of every result, so a friend/family helper who reads English
  // can follow along. Identical to `results` when the user's language is English.
  resultsEnglish?: CallResult[];
};

// The UI localizes via LLM translation, so any language works. These are the
// picker options; native names first so people can find their own language.
const LOCALE_OPTIONS = [
  { value: "en-US", label: "English" },
  { value: "es-ES", label: "Español (Spanish)" },
  { value: "zh-CN", label: "中文 (Chinese)" },
  { value: "tl-PH", label: "Tagalog (Filipino)" },
  { value: "vi-VN", label: "Tiếng Việt (Vietnamese)" },
  { value: "ar-SA", label: "العربية (Arabic)" },
  { value: "fr-FR", label: "Français (French)" },
  { value: "ko-KR", label: "한국어 (Korean)" },
  { value: "ru-RU", label: "Русский (Russian)" },
  { value: "ht-HT", label: "Kreyòl Ayisyen (Haitian Creole)" },
  { value: "de-DE", label: "Deutsch (German)" },
  { value: "hi-IN", label: "हिन्दी (Hindi)" },
  { value: "pt-BR", label: "Português (Portuguese)" },
  { value: "it-IT", label: "Italiano (Italian)" },
  { value: "pl-PL", label: "Polski (Polish)" },
  { value: "ur-PK", label: "اردو (Urdu)" },
  { value: "ja-JP", label: "日本語 (Japanese)" },
  { value: "fa-IR", label: "فارسی (Persian)" },
  { value: "gu-IN", label: "ગુજરાતી (Gujarati)" },
  { value: "te-IN", label: "తెలుగు (Telugu)" },
  { value: "bn-IN", label: "বাংলা (Bengali)" },
  { value: "ta-IN", label: "தமிழ் (Tamil)" },
  { value: "pa-IN", label: "ਪੰਜਾਬੀ (Punjabi)" },
  { value: "el-GR", label: "Ελληνικά (Greek)" },
  { value: "km-KH", label: "ខ្មែរ (Khmer)" },
  { value: "th-TH", label: "ไทย (Thai)" },
  { value: "hy-AM", label: "Հայերեն (Armenian)" },
  { value: "am-ET", label: "አማርኛ (Amharic)" },
  { value: "so-SO", label: "Soomaali (Somali)" },
  { value: "uk-UA", label: "Українська (Ukrainian)" }
];

let targetIdCounter = 0;
function nextTargetId(): string {
  targetIdCounter += 1;
  return `target-${targetIdCounter}`;
}

function emptyTarget(): Target {
  return { id: nextTargetId(), venueName: "", phoneE164: "" };
}

/* Small inline-SVG icons — no icon libraries, keep them tasteful and warm. */

function WordmarkIcon() {
  return (
    <svg className="wordmark-icon" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="var(--accent-soft)" />
      <path
        d="M13 15.5c0-1.4 1.1-2.5 2.5-2.5h1.2c.7 0 1.4.5 1.6 1.2l1 3.1c.2.7 0 1.5-.5 2l-1.3 1.2a13 13 0 0 0 5.4 5.4l1.2-1.3c.5-.5 1.3-.7 2-.5l3.1 1c.7.2 1.2.9 1.2 1.6v1.2c0 1.4-1.1 2.5-2.5 2.5C19.8 30.4 9.6 20.2 13 15.5Z"
        fill="var(--accent)"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="cue-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 5 6v5.2c0 4.6 3 7.9 7 9.3 4-1.4 7-4.7 7-9.3V6l-7-2.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 12.2l2 2 4-4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg className="lang-switcher-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3 12h18M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="cue-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 12.3l2.5 2.5L16 9.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="cue-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7.3 4h2.1l1.2 3.6-1.7 1.6a12 12 0 0 0 5.9 5.9l1.6-1.7L20 14.6v2.1c0 1.3-1.1 2.3-2.4 2.1-6.6-1-11.4-5.8-12.4-12.4C4.9 5.1 5.9 4 7.3 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className="btn-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 3.5 4.5 8l5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function App() {
  const [screen, setScreen] = useState<1 | 2 | 3>(1);

  // Auto-localized UI copy. Starts as EN; handleInterpret swaps in the
  // translated bundle once it detects a non-English request.
  const [s, setS] = useState<UIStrings>(EN);

  // Screen 1 state
  const [intentText, setIntentText] = useState("");
  const [userLocale, setUserLocale] = useState("en-US");
  const [callLocale, setCallLocale] = useState("");
  const [targets, setTargets] = useState<Target[]>([emptyTarget()]);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [interpretError, setInterpretError] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [localizing, setLocalizing] = useState(false);
  // Language detected from what they've typed so far, used to name the button
  // ("Show this page in Español") before they click it. "" = not yet known.
  const [detectedLocale, setDetectedLocale] = useState("");
  // True once the person has explicitly picked a language (dropdown, switcher,
  // or the detect button). When false, interpreting follows the language they
  // wrote their request in, so the plan always matches the screen.
  const [localeExplicitlyChosen, setLocaleExplicitlyChosen] = useState(false);

  // Screen 2 state
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  // Screen 3 state
  const [runResult, setRunResult] = useState<RunResponse | null>(null);
  const [showEnglishResults, setShowEnglishResults] = useState(false);
  const [callbackPhone, setCallbackPhone] = useState("");
  const [callbackStatus, setCallbackStatus] = useState<"idle" | "calling" | "done" | "error">("idle");

  function updateTarget(id: string, patch: Partial<Target>) {
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function addTarget() {
    if (targets.length >= 5) return;
    setTargets((prev) => [...prev, emptyTarget()]);
  }

  function removeTarget(id: string) {
    setTargets((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev));
  }

  // Quietly detect the language of what they're typing (debounced) so the
  // button can name it -- "Show this page in Español" -- before they click.
  // This only sets a label; it never flips the page on its own (that stays an
  // explicit button press), so there's no surprise re-render mid-typing.
  useEffect(() => {
    const text = intentText.trim();
    if (text.length < 8) {
      setDetectedLocale("");
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const response = await fetch("/api/intent/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        if (response.ok) {
          const body = await response.json();
          setDetectedLocale(body.detectedLocale || "");
        }
      } catch {
        // Leave the label as-is if detection fails.
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [intentText]);

  // One-tap return to English, for the person (or an English-speaking helper)
  // who flipped the UI and wants the original language back. No network call --
  // the English strings ship with the app.
  function resetToEnglish() {
    setS(EN);
    setUserLocale("en-US");
    setDetectedLocale("");
    document.documentElement.lang = "en-US";
    document.documentElement.dir = "ltr";
  }

  // Flip the whole UI into `detectedLocale` (labels, buttons, disclosure,
  // results) so a non-native speaker can finish the form in their own language.
  // English, or a repeat of what's already on screen, is a no-op; any failure
  // just leaves the UI in its current language.
  async function applyDetectedLocale(detectedLocale: string): Promise<void> {
    if (
      !detectedLocale ||
      detectedLocale.toLowerCase().startsWith("en") ||
      detectedLocale === userLocale
    ) {
      return;
    }
    try {
      const localizeResponse = await fetch("/api/ui/localize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: detectedLocale, strings: EN })
      });
      const localizeBody = await localizeResponse.json();
      if (localizeResponse.ok && localizeBody.strings) {
        setS(localizeBody.strings as UIStrings);
        setUserLocale(detectedLocale);
        document.documentElement.lang = detectedLocale;
        document.documentElement.dir = isRtlLocale(detectedLocale) ? "rtl" : "ltr";
      }
    } catch {
      // Keep everything in its current language if localize fails.
    }
  }

  // Picking a language from the dropdown flips the whole page into it right
  // away, even with the intent box still empty -- so someone who can't read
  // the English form can switch first, then fill it in. English reverts.
  async function handleUserLocaleChange(newLocale: string) {
    setLocaleExplicitlyChosen(true);
    if (newLocale.toLowerCase().startsWith("en")) {
      resetToEnglish();
      return;
    }
    if (newLocale === userLocale) return;
    setDetectedLocale(newLocale);
    setLocalizing(true);
    try {
      await applyDetectedLocale(newLocale);
    } finally {
      setLocalizing(false);
    }
  }

  // Ask Warmline to call the person back and read the results aloud in their
  // language. The spoken summary is built from the results already on screen.
  async function handleRequestCallback() {
    const summary = buildCallbackSummary(runResult?.results ?? []);
    if (callbackPhone.trim().length < 8 || !summary || callbackStatus === "calling") return;
    setCallbackStatus("calling");
    try {
      const response = await fetch("/api/missions/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneE164: callbackPhone.trim(), locale: userLocale, summary })
      });
      setCallbackStatus(response.ok ? "done" : "error");
    } catch {
      setCallbackStatus("error");
    }
  }

  // Explicit "show this page in my language" action. The person types their
  // request, taps the button, and we detect the language of what they wrote
  // and flip the whole UI into it -- with a visible loading label, so the
  // wait is intentional rather than the silent lag the old on-blur had.
  async function handleDetectAndLocalize() {
    const text = intentText.trim();
    if (text.length < 3 || localizing) return;
    setLocaleExplicitlyChosen(true);
    setLocalizing(true);
    try {
      // Reuse the language the debounced detector already found; only ask the
      // server again if we don't have one yet.
      let detected = detectedLocale;
      if (!detected) {
        const response = await fetch("/api/intent/detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        detected = response.ok ? (await response.json()).detectedLocale : "en";
      }
      await applyDetectedLocale(detected || "en");
    } catch {
      // Leave the UI in its current language on failure.
    } finally {
      setLocalizing(false);
    }
  }

  async function handleInterpret() {
    setInterpretError("");

    if (intentText.trim().length < 3) {
      setInterpretError(s.errorIntentTooShort);
      return;
    }
    if (targets.some((t) => !t.venueName.trim() || !t.phoneE164.trim())) {
      setInterpretError(s.errorTargetsIncomplete);
      return;
    }
    if (!disclosureAccepted) {
      setInterpretError(s.errorDisclosureRequired);
      return;
    }

    setInterpreting(true);
    try {
      // Settle the review-screen language BEFORE generating the plan, so the
      // plan text comes back in that same language. If the person explicitly
      // picked a language, honor it. Otherwise follow the language they wrote
      // their request in (detecting it now if we have not already), and flip
      // the page to it first.
      let planLocale = userLocale;
      if (!localeExplicitlyChosen) {
        let detected = detectedLocale;
        if (!detected) {
          try {
            const detectResponse = await fetch("/api/intent/detect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: intentText.trim() })
            });
            if (detectResponse.ok) {
              detected = (await detectResponse.json()).detectedLocale || "";
            }
          } catch {
            // Fall through and keep the current language.
          }
        }
        if (detected && !detected.toLowerCase().startsWith("en")) {
          await applyDetectedLocale(detected);
          planLocale = detected;
        } else {
          planLocale = "en-US";
        }
      }

      const response = await fetch("/api/intent/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText, userLocale: planLocale })
      });
      const body = await response.json();
      if (!response.ok) {
        setInterpretError(body.error ?? s.errorInterpretFailed);
        return;
      }
      const receivedPlan = body.plan as Plan;
      setPlan(receivedPlan);
      setScreen(2);
    } catch {
      setInterpretError(s.errorNetwork);
    } finally {
      setInterpreting(false);
    }
  }

  async function handleRun() {
    if (!plan) return;
    setRunError("");
    setRunning(true);

    const missionId = `mission-${Date.now()}`;
    const body = {
      id: missionId,
      kind: plan.kind,
      userLocale,
      callLocale: callLocale || undefined,
      disclosureAccepted: true,
      targets: targets.map((t) => ({
        id: t.id,
        venueName: t.venueName,
        phoneE164: t.phoneE164,
        approved: true
      })),
      ...plan.fields
    };

    try {
      const response = await fetch("/api/missions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const responseBody = await response.json();
      if (!response.ok) {
        setRunError(responseBody.error ?? s.errorRunFailed);
        return;
      }
      setRunResult(responseBody as RunResponse);
      setScreen(3);
    } catch {
      setRunError(s.errorNetwork);
    } finally {
      setRunning(false);
    }
  }

  function startOver() {
    setScreen(1);
    setIntentText("");
    setTargets([emptyTarget()]);
    setDisclosureAccepted(false);
    setPlan(null);
    setRunResult(null);
    setRunError("");
    setInterpretError("");
  }

  const progressSteps = [s.stepIntake, s.stepReview, s.stepResult];

  return (
    <div className="app-shell">
      {localizing && (
        <div className="locale-loading-overlay" role="status" aria-live="polite">
          <div className="locale-loading-card">
            <span className="locale-spinner" aria-hidden="true" />
            <span className="locale-loading-text">{loadingMessageForLocale(detectedLocale)}</span>
            {languageEndonym(detectedLocale) && (
              <span className="locale-loading-sub">{languageEndonym(detectedLocale)}</span>
            )}
          </div>
        </div>
      )}
      <div className="app">
        <header className="site-header">
          <div className="wordmark">
            <WordmarkIcon />
            <span className="wordmark-text">Warmline</span>
          </div>
          <div className="lang-switcher" title={s.yourLanguageLabel}>
            <GlobeIcon />
            <select
              className="lang-switcher-select"
              value={userLocale}
              onChange={(e) => handleUserLocaleChange(e.target.value)}
              aria-label={s.yourLanguageLabel}
            >
              {LOCALE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className="hero">
          <div className="eyebrow">{s.eyebrow}</div>
          <h1>
            {s.headlineLine1}
            <br />
            <em>{s.headlineLine2}</em>
          </h1>
          <p>{s.subhead}</p>
          <ul className="trust-chips" aria-label={s.disclosureText}>
            <li className="trust-chip">
              <CheckIcon />
              {s.trustApprove}
            </li>
            <li className="trust-chip">
              <CheckIcon />
              {s.trustDisclosed}
            </li>
            <li className="trust-chip">
              <CheckIcon />
              {s.trustNoCommit}
            </li>
          </ul>
        </section>

        <ol className="progress-steps" aria-label={s.progressAriaLabel}>
          {progressSteps.map((label, i) => {
            const stepNumber = (i + 1) as 1 | 2 | 3;
            const state = stepNumber === screen ? "current" : stepNumber < screen ? "done" : "upcoming";
            return (
              <li key={stepNumber} className={`progress-step is-${state}`}>
                <span className="progress-dot" aria-hidden="true">
                  {state === "done" ? <CheckIcon /> : stepNumber}
                </span>
                <span className="progress-label">{label}</span>
              </li>
            );
          })}
        </ol>

        {screen === 1 && (
          <section className="card">
            <h2 className="card-title">{s.screen1Title}</h2>
            <p className="card-subtitle">{s.screen1Subtitle}</p>

            <label className="field">
              <span className="field-label">{s.intentLabel}</span>
              <textarea
                className="intent-textarea"
                value={intentText}
                onChange={(e) => setIntentText(e.target.value)}
                placeholder={s.intentPlaceholder}
                rows={4}
              />
            </label>

            <button
              type="button"
              className="secondary-button locale-detect-button"
              onClick={handleDetectAndLocalize}
              disabled={localizing || intentText.trim().length < 3}
            >
              {localizing
                ? s.detectingLanguageButton
                : detectedLocale &&
                    !detectedLocale.toLowerCase().startsWith("en") &&
                    languageEndonym(detectedLocale)
                  ? `${s.showThisPageInPrefix} ${languageEndonym(detectedLocale)}`
                  : s.detectLanguageButton}
            </button>

            <div className="field-row">
              <label className="field">
                <span className="field-label">{s.yourLanguageLabel}</span>
                <select value={userLocale} onChange={(e) => handleUserLocaleChange(e.target.value)}>
                  {LOCALE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">{s.callLanguageLabel}</span>
                <select value={callLocale} onChange={(e) => setCallLocale(e.target.value)}>
                  <option value="">{s.callLanguageSameOption}</option>
                  {LOCALE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="card-divider" role="presentation" />

            <h2 className="card-title">{s.targetsTitle}</h2>
            <div className="target-list">
              {targets.map((target, index) => (
                <div className="target-row" key={target.id}>
                  <div className="target-fields">
                    <label className="field">
                      <span className="field-label">{s.businessNameLabel}</span>
                      <input
                        type="text"
                        value={target.venueName}
                        onChange={(e) => updateTarget(target.id, { venueName: e.target.value })}
                        placeholder={s.businessNamePlaceholder}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">{s.phoneLabel}</span>
                      <input
                        type="text"
                        value={target.phoneE164}
                        onChange={(e) => updateTarget(target.id, { phoneE164: e.target.value })}
                        placeholder={s.phonePlaceholder}
                      />
                    </label>
                  </div>
                  {targets.length > 1 && (
                    <button
                      type="button"
                      className="link-button link-button-muted"
                      onClick={() => removeTarget(target.id)}
                    >
                      <RemoveIcon />
                      {s.removeButton}
                    </button>
                  )}
                </div>
              ))}
              {targets.length < 5 && (
                <button type="button" className="link-button" onClick={addTarget}>
                  <AddIcon />
                  {s.addAnotherButton}
                </button>
              )}
            </div>

            <label className="reassurance-note checkbox-field">
              <input
                type="checkbox"
                checked={disclosureAccepted}
                onChange={(e) => setDisclosureAccepted(e.target.checked)}
              />
              <ShieldIcon />
              <span>{s.disclosureText}</span>
            </label>

            {interpretError && (
              <p className="error" role="alert">
                {interpretError}
              </p>
            )}

            <button type="button" className="primary-button" onClick={handleInterpret} disabled={interpreting}>
              {interpreting ? s.understandingButton : s.reviewCallButton}
            </button>
          </section>
        )}

        {screen === 2 && plan && (
          <section className="card">
            <h2 className="card-title">{s.screen2Title}</h2>
            <p className="card-subtitle">{s.screen2Subtitle}</p>

            <div className="plan-block">
              <span className="plan-block-label">{s.planCallLabel}</span>
              <p className="plan-venues">{targets.map((t) => t.venueName).join(", ")}</p>
            </div>

            <div className="plan-block">
              <span className="plan-block-label">{s.planAskLabel}</span>
              <blockquote className="plan-goal">{plan.callGoal}</blockquote>
            </div>

            <div className="plan-block">
              <span className="plan-block-label">{s.planSayLabel}</span>
              <p className="plan-disclosure">&ldquo;{plan.disclosureLine}&rdquo;</p>
            </div>

            <div className="reassurance-note">
              <CheckIcon />
              <span>{s.planReassurance}</span>
            </div>

            {runError && (
              <p className="error" role="alert">
                {runError}
              </p>
            )}

            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => setScreen(1)}>
                <BackIcon />
                {s.backButton}
              </button>
              <button type="button" className="primary-button" onClick={handleRun} disabled={running}>
                {running ? s.preparingCallButton : s.makeCallButton}
              </button>
            </div>
          </section>
        )}

        {screen === 3 && runResult && (
          <section className="card">
            <h2 className="card-title">{s.screen3Title}</h2>
            <p className="mode-note">
              {s.modeLabel} {runResult.mode}
            </p>

            {!userLocale.toLowerCase().startsWith("en") && runResult.resultsEnglish && (
              <button
                type="button"
                className="secondary-button results-lang-toggle"
                onClick={() => setShowEnglishResults((v) => !v)}
              >
                {showEnglishResults ? s.resultsInMyLanguageToggle : s.resultsInEnglishToggle}
              </button>
            )}

            <ul className="results-list">
              {(showEnglishResults && runResult.resultsEnglish
                ? runResult.resultsEnglish
                : runResult.results
              ).map((result) => {
                // When showing the English copy, label it in English too so a
                // friend/family helper reads a fully-English card.
                const rs = showEnglishResults ? EN : s;
                const isBest = result.status === "completed" && result.confidence === "high";
                return (
                  <li className={`result-item${isBest ? " result-item-best" : ""}`} key={result.targetId}>
                    {isBest && (
                      <div className="result-best-badge">
                        <CheckIcon />
                        {rs.bestAnswerBadge}
                      </div>
                    )}
                    <div className="result-header">
                      <strong className="result-venue">{result.venueName}</strong>
                      <span className={`outcome-chip outcome-${result.status}`}>{result.outcome}</span>
                    </div>
                    <p className="result-confidence">
                      {rs.confidenceLabel} {result.confidence}
                    </p>
                    <dl className="result-data">
                      {Object.entries(result.data).map(([key, value]) => (
                        <div className="result-data-row" key={key}>
                          <dt>{key}</dt>
                          <dd>{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</dd>
                        </div>
                      ))}
                    </dl>
                    {result.followUpRequired && (
                      <p className="result-followup">
                        {rs.followUpLabel} {result.followUpInstructions}
                      </p>
                    )}
                    {result.evidence.length > 0 && (
                      <ul className="result-evidence">
                        {result.evidence.map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="callback-card">
              <p className="callback-title">{s.callbackTitle}</p>
              <p className="callback-subtitle">{s.callbackSubtitle}</p>
              <div className="callback-row">
                <input
                  className="callback-input"
                  type="tel"
                  inputMode="tel"
                  value={callbackPhone}
                  onChange={(e) => {
                    setCallbackPhone(e.target.value);
                    if (callbackStatus !== "idle") setCallbackStatus("idle");
                  }}
                  placeholder="+12025550123"
                  aria-label={s.callbackPhoneLabel}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={handleRequestCallback}
                  disabled={callbackStatus === "calling" || callbackPhone.trim().length < 8}
                >
                  {callbackStatus === "calling" ? s.callbackCalling : s.callbackButton}
                </button>
              </div>
              {callbackStatus === "done" && (
                <p className="callback-status is-ok" role="status">
                  {s.callbackDone}
                </p>
              )}
              {callbackStatus === "error" && (
                <p className="callback-status is-err" role="alert">
                  {s.callbackError}
                </p>
              )}
            </div>

            <div className="reassurance-note">
              <PhoneIcon />
              <span>{s.resultsReassurance}</span>
            </div>

            <button type="button" className="primary-button" onClick={startOver}>
              {s.startOverButton}
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
