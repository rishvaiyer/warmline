import { useState } from "react";
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

  // Screen 2 state
  const [plan, setPlan] = useState<Plan | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");

  // Screen 3 state
  const [runResult, setRunResult] = useState<RunResponse | null>(null);

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
      const response = await fetch("/api/intent/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intentText, userLocale })
      });
      const body = await response.json();
      if (!response.ok) {
        setInterpretError(body.error ?? s.errorInterpretFailed);
        return;
      }
      const receivedPlan = body.plan as Plan;
      setPlan(receivedPlan);

      // Auto-localize the whole UI to the language the person typed their
      // request in, so a non-native speaker can finish the form without
      // ever switching the language selector themselves. English (or a
      // repeat of the locale already on screen) is a no-op; any failure
      // here just leaves the UI in English/its current state.
      const detectedLocale = receivedPlan.detectedLocale || "en";
      if (!detectedLocale.toLowerCase().startsWith("en") && detectedLocale !== userLocale) {
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
          // Keep everything English if localize fails.
        }
      }

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
      <div className="app">
        <header className="site-header">
          <div className="wordmark">
            <WordmarkIcon />
            <span className="wordmark-text">Warmline</span>
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

            <div className="field-row">
              <label className="field">
                <span className="field-label">{s.yourLanguageLabel}</span>
                <select value={userLocale} onChange={(e) => setUserLocale(e.target.value)}>
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

            <ul className="results-list">
              {runResult.results.map((result) => {
                const isBest = result.status === "completed" && result.confidence === "high";
                return (
                  <li className={`result-item${isBest ? " result-item-best" : ""}`} key={result.targetId}>
                    {isBest && (
                      <div className="result-best-badge">
                        <CheckIcon />
                        {s.bestAnswerBadge}
                      </div>
                    )}
                    <div className="result-header">
                      <strong className="result-venue">{result.venueName}</strong>
                      <span className={`outcome-chip outcome-${result.status}`}>{result.outcome}</span>
                    </div>
                    <p className="result-confidence">
                      {s.confidenceLabel} {result.confidence}
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
                        {s.followUpLabel} {result.followUpInstructions}
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
