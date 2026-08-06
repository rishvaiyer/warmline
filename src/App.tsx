import { useState } from "react";

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
};

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

const LOCALE_OPTIONS = [
  { value: "en-US", label: "English (US)" },
  { value: "es-ES", label: "Español" },
  { value: "fr-FR", label: "Français" },
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "zh-CN", label: "中文" },
  { value: "ar-SA", label: "العربية" },
  { value: "hi-IN", label: "हिन्दी" }
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

const PROGRESS_STEPS = ["What you need", "Review", "Result"] as const;

export default function App() {
  const [screen, setScreen] = useState<1 | 2 | 3>(1);

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
      setInterpretError("Say a bit more about what you need.");
      return;
    }
    if (targets.some((t) => !t.venueName.trim() || !t.phoneE164.trim())) {
      setInterpretError("Every target needs a name and a phone number in E.164 format (e.g. +12025550123).");
      return;
    }
    if (!disclosureAccepted) {
      setInterpretError("Please confirm you understand this will place a call on your behalf.");
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
        setInterpretError(body.error ?? "Could not interpret that request.");
        return;
      }
      setPlan(body.plan as Plan);
      setScreen(2);
    } catch {
      setInterpretError("Could not reach the server. Is it running?");
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
        setRunError(responseBody.error ?? "The mission could not run.");
        return;
      }
      setRunResult(responseBody as RunResponse);
      setScreen(3);
    } catch {
      setRunError("Could not reach the server. Is it running?");
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

  return (
    <div className="app-shell">
      <div className="app">
        <header className="app-header">
          <div className="wordmark">
            <WordmarkIcon />
            <span className="wordmark-text">Warmline</span>
          </div>
          <h1>We'll make the call, so you don't have to.</h1>
          <p>Say what you need, in any language. We'll call the business and read the answer back to you.</p>
        </header>

        <ol className="progress-steps" aria-label="Progress">
          {PROGRESS_STEPS.map((label, i) => {
            const stepNumber = (i + 1) as 1 | 2 | 3;
            const state = stepNumber === screen ? "current" : stepNumber < screen ? "done" : "upcoming";
            return (
              <li key={label} className={`progress-step is-${state}`}>
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
            <h2 className="card-title">What do you need help with?</h2>
            <p className="card-subtitle">Tell us in your own words — any language is fine.</p>

            <label className="field">
              <span className="field-label">What you want handled</span>
              <textarea
                className="intent-textarea"
                value={intentText}
                onChange={(e) => setIntentText(e.target.value)}
                placeholder='e.g. "quiero una cita con mi dentista lo antes posible"'
                rows={4}
              />
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">Your language</span>
                <select value={userLocale} onChange={(e) => setUserLocale(e.target.value)}>
                  {LOCALE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field-label">Call in a different language (optional)</span>
                <select value={callLocale} onChange={(e) => setCallLocale(e.target.value)}>
                  <option value="">Same as my language</option>
                  {LOCALE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="card-divider" role="presentation" />

            <h2 className="card-title">Who should we call?</h2>
            <div className="target-list">
              {targets.map((target, index) => (
                <div className="target-row" key={target.id}>
                  <div className="target-fields">
                    <label className="field">
                      <span className="field-label">Business name</span>
                      <input
                        type="text"
                        value={target.venueName}
                        onChange={(e) => updateTarget(target.id, { venueName: e.target.value })}
                        placeholder="Dr. Smith Dental"
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">Phone number (E.164)</span>
                      <input
                        type="text"
                        value={target.phoneE164}
                        onChange={(e) => updateTarget(target.id, { phoneE164: e.target.value })}
                        placeholder="+12025550123"
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
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {targets.length < 5 && (
                <button type="button" className="link-button" onClick={addTarget}>
                  <AddIcon />
                  Add another business
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
              <span>
                I understand an AI assistant will call on my behalf, disclose itself as an AI, and will not
                book, pay, or commit to anything without my review.
              </span>
            </label>

            {interpretError && (
              <p className="error" role="alert">
                {interpretError}
              </p>
            )}

            <button type="button" className="primary-button" onClick={handleInterpret} disabled={interpreting}>
              {interpreting ? "Understanding your request…" : "Review the call"}
            </button>
          </section>
        )}

        {screen === 2 && plan && (
          <section className="card">
            <h2 className="card-title">Here's exactly what we'll do</h2>
            <p className="card-subtitle">Take a look before anything happens. Nothing is final yet.</p>

            <div className="plan-block">
              <span className="plan-block-label">We'll call</span>
              <p className="plan-venues">{targets.map((t) => t.venueName).join(", ")}</p>
            </div>

            <div className="plan-block">
              <span className="plan-block-label">And ask</span>
              <blockquote className="plan-goal">{plan.callGoal}</blockquote>
            </div>

            <div className="plan-block">
              <span className="plan-block-label">We'll say, first thing</span>
              <p className="plan-disclosure">&ldquo;{plan.disclosureLine}&rdquo;</p>
            </div>

            <div className="reassurance-note">
              <CheckIcon />
              <span>We won't book, pay, or commit to anything on this call — only you can approve that.</span>
            </div>

            {runError && (
              <p className="error" role="alert">
                {runError}
              </p>
            )}

            <div className="button-row">
              <button type="button" className="secondary-button" onClick={() => setScreen(1)}>
                <BackIcon />
                Back
              </button>
              <button type="button" className="primary-button" onClick={handleRun} disabled={running}>
                {running ? "Preparing the call…" : "Make the call"}
              </button>
            </div>
          </section>
        )}

        {screen === 3 && runResult && (
          <section className="card">
            <h2 className="card-title">Here's what we found</h2>
            <p className="mode-note">Mode: {runResult.mode}</p>

            <ul className="results-list">
              {runResult.results.map((result) => {
                const isBest = result.status === "completed" && result.confidence === "high";
                return (
                  <li className={`result-item${isBest ? " result-item-best" : ""}`} key={result.targetId}>
                    {isBest && (
                      <div className="result-best-badge">
                        <CheckIcon />
                        Best answer
                      </div>
                    )}
                    <div className="result-header">
                      <strong className="result-venue">{result.venueName}</strong>
                      <span className={`outcome-chip outcome-${result.status}`}>{result.outcome}</span>
                    </div>
                    <p className="result-confidence">Confidence: {result.confidence}</p>
                    <dl className="result-data">
                      {Object.entries(result.data).map(([key, value]) => (
                        <div className="result-data-row" key={key}>
                          <dt>{key}</dt>
                          <dd>{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</dd>
                        </div>
                      ))}
                    </dl>
                    {result.followUpRequired && (
                      <p className="result-followup">Follow-up: {result.followUpInstructions}</p>
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
              <span>Nothing was booked or paid for. Review the details above before you act on them.</span>
            </div>

            <button type="button" className="primary-button" onClick={startOver}>
              Start over
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
