// Centralized UI copy for App.tsx. `EN` is the single source of truth for
// every user-facing string in the interface; the auto-localize flow
// (App.tsx handleInterpret -> POST /api/ui/localize) sends this exact bundle
// to the server and swaps in the translated bundle it gets back, keyed by
// the same fields. Keep this file in sync with App.tsx literals -- if you
// add a new visible string there, add a key here first and reference it via
// the `s.<key>` lookup instead of an inline literal.

export type UIStrings = {
  // Header
  headline: string;
  subhead: string;

  // Progress steps
  stepIntake: string;
  stepReview: string;
  stepResult: string;
  progressAriaLabel: string;

  // Screen 1: intake
  screen1Title: string;
  screen1Subtitle: string;
  intentLabel: string;
  intentPlaceholder: string;
  yourLanguageLabel: string;
  callLanguageLabel: string;
  callLanguageSameOption: string;
  targetsTitle: string;
  businessNameLabel: string;
  businessNamePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  removeButton: string;
  addAnotherButton: string;
  disclosureText: string;
  errorIntentTooShort: string;
  errorTargetsIncomplete: string;
  errorDisclosureRequired: string;
  errorInterpretFailed: string;
  errorNetwork: string;
  understandingButton: string;
  reviewCallButton: string;

  // Screen 2: plan review
  screen2Title: string;
  screen2Subtitle: string;
  planCallLabel: string;
  planAskLabel: string;
  planSayLabel: string;
  planReassurance: string;
  errorRunFailed: string;
  backButton: string;
  preparingCallButton: string;
  makeCallButton: string;

  // Screen 3: results
  screen3Title: string;
  modeLabel: string;
  bestAnswerBadge: string;
  confidenceLabel: string;
  followUpLabel: string;
  resultsReassurance: string;
  startOverButton: string;
};

export const EN: UIStrings = {
  headline: "We'll make the call, so you don't have to.",
  subhead: "Say what you need, in any language. We'll call the business and read the answer back to you.",

  stepIntake: "What you need",
  stepReview: "Review",
  stepResult: "Result",
  progressAriaLabel: "Progress",

  screen1Title: "What do you need help with?",
  screen1Subtitle: "Tell us in your own words — any language is fine.",
  intentLabel: "What you want handled",
  intentPlaceholder: 'e.g. "quiero una cita con mi dentista lo antes posible"',
  yourLanguageLabel: "Your language",
  callLanguageLabel: "Call in a different language (optional)",
  callLanguageSameOption: "Same as my language",
  targetsTitle: "Who should we call?",
  businessNameLabel: "Business name",
  businessNamePlaceholder: "Dr. Smith Dental",
  phoneLabel: "Phone number (E.164)",
  phonePlaceholder: "+12025550123",
  removeButton: "Remove",
  addAnotherButton: "Add another business",
  disclosureText:
    "I understand an AI assistant will call on my behalf, disclose itself as an AI, and will not book, pay, or commit to anything without my review.",
  errorIntentTooShort: "Say a bit more about what you need.",
  errorTargetsIncomplete: "Every target needs a name and a phone number in E.164 format (e.g. +12025550123).",
  errorDisclosureRequired: "Please confirm you understand this will place a call on your behalf.",
  errorInterpretFailed: "Could not interpret that request.",
  errorNetwork: "Could not reach the server. Is it running?",
  understandingButton: "Understanding your request…",
  reviewCallButton: "Review the call",

  screen2Title: "Here's exactly what we'll do",
  screen2Subtitle: "Take a look before anything happens. Nothing is final yet.",
  planCallLabel: "We'll call",
  planAskLabel: "And ask",
  planSayLabel: "We'll say, first thing",
  planReassurance: "We won't book, pay, or commit to anything on this call — only you can approve that.",
  errorRunFailed: "The mission could not run.",
  backButton: "Back",
  preparingCallButton: "Preparing the call…",
  makeCallButton: "Make the call",

  screen3Title: "Here's what we found",
  modeLabel: "Mode:",
  bestAnswerBadge: "Best answer",
  confidenceLabel: "Confidence:",
  followUpLabel: "Follow-up:",
  resultsReassurance: "Nothing was booked or paid for. Review the details above before you act on them.",
  startOverButton: "Start over"
};
