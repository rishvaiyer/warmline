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
    <div className="app">
      <header className="app-header">
        <h1>Warmline</h1>
        <p>Say what you need, in any language. We'll call, and read the answer back to you.</p>
      </header>

      {screen === 1 && (
        <section className="card">
          <h2>1. What do you need?</h2>
          <label className="field">
            <span>Tell us what you want handled, in any language</span>
            <textarea
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
              placeholder='e.g. "quiero una cita con mi dentista lo antes posible"'
              rows={4}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Your language</span>
              <select value={userLocale} onChange={(e) => setUserLocale(e.target.value)}>
                {LOCALE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Call in a different language (optional)</span>
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

          <h2>2. Who should we call?</h2>
          {targets.map((target, index) => (
            <div className="target-row" key={target.id}>
              <label className="field">
                <span>Business name</span>
                <input
                  type="text"
                  value={target.venueName}
                  onChange={(e) => updateTarget(target.id, { venueName: e.target.value })}
                  placeholder="Dr. Smith Dental"
                />
              </label>
              <label className="field">
                <span>Phone number (E.164)</span>
                <input
                  type="text"
                  value={target.phoneE164}
                  onChange={(e) => updateTarget(target.id, { phoneE164: e.target.value })}
                  placeholder="+12025550123"
                />
              </label>
              {targets.length > 1 && (
                <button type="button" className="link-button" onClick={() => removeTarget(target.id)}>
                  Remove
                </button>
              )}
              {index === targets.length - 1 && targets.length < 5 && (
                <button type="button" className="link-button" onClick={addTarget}>
                  + Add another
                </button>
              )}
            </div>
          ))}

          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={disclosureAccepted}
              onChange={(e) => setDisclosureAccepted(e.target.checked)}
            />
            <span>
              I understand an AI assistant will call on my behalf, disclose itself as an AI, and will not
              book, pay, or commit to anything without my review.
            </span>
          </label>

          {interpretError && <p className="error">{interpretError}</p>}

          <button type="button" className="primary-button" onClick={handleInterpret} disabled={interpreting}>
            {interpreting ? "Thinking..." : "Review the plan"}
          </button>
        </section>
      )}

      {screen === 2 && plan && (
        <section className="card">
          <h2>Review the plan</h2>
          <p className="plan-summary">
            I'll call <strong>{targets.map((t) => t.venueName).join(", ")}</strong> and ask:
          </p>
          <blockquote className="plan-goal">{plan.callGoal}</blockquote>
          <p className="plan-disclosure">
            I'll say: <em>&ldquo;{plan.disclosureLine}&rdquo;</em>
          </p>
          <p className="plan-note">I won't book, pay, or commit to anything on this call.</p>

          {runError && <p className="error">{runError}</p>}

          <div className="button-row">
            <button type="button" className="secondary-button" onClick={() => setScreen(1)}>
              Back
            </button>
            <button type="button" className="primary-button" onClick={handleRun} disabled={running}>
              {running ? "Calling..." : "Run the call"}
            </button>
          </div>
        </section>
      )}

      {screen === 3 && runResult && (
        <section className="card">
          <h2>Results</h2>
          <p className="mode-note">Mode: {runResult.mode}</p>
          <ul className="results-list">
            {runResult.results.map((result) => (
              <li className="result-item" key={result.targetId}>
                <div className="result-header">
                  <strong>{result.venueName}</strong>
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
            ))}
          </ul>

          <button type="button" className="primary-button" onClick={startOver}>
            Start a new request
          </button>
        </section>
      )}
    </div>
  );
}
