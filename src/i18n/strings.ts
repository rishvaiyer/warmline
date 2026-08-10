// Centralized UI copy for App.tsx. `EN` is the single source of truth for
// every user-facing string in the interface; the auto-localize flow
// (App.tsx handleInterpret -> POST /api/ui/localize) sends this exact bundle
// to the server and swaps in the translated bundle it gets back, keyed by
// the same fields. Keep this file in sync with App.tsx literals -- if you
// add a new visible string there, add a key here first and reference it via
// the `s.<key>` lookup instead of an inline literal.

export type UIStrings = {
  // Header / hero
  eyebrow: string;
  headlineLine1: string;
  headlineLine2: string;
  subhead: string;
  trustDisclosed: string;
  trustApprove: string;

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
  speakRequestButton: string;
  speakRequestHint: string;
  speakRecordingButton: string;
  speakTranscribingButton: string;
  speakHeardLanguagePrefix: string;
  errorMicDenied: string;
  errorTranscribeFailed: string;
  errorNothingHeard: string;
  detectLanguageButton: string;
  showThisPageInPrefix: string;
  detectingLanguageButton: string;
  resultsInEnglishToggle: string;
  resultsInMyLanguageToggle: string;
  themeToDarkLabel: string;
  themeToLightLabel: string;
  yourLanguageLabel: string;
  callLanguageLabel: string;
  callLanguageSameOption: string;
  callerNameLabel: string;
  callerNamePlaceholder: string;
  callerNameHint: string;
  targetsTitle: string;
  businessNameLabel: string;
  businessNamePlaceholder: string;
  phoneLabel: string;
  phonePlaceholder: string;
  removeButton: string;
  addAnotherButton: string;
  disclosureText: string;
  bookingConsentText: string;
  bookingConsentHint: string;
  errorBookingNeedsName: string;
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
  planReassuranceNoBooking: string;
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
  commitmentWarningTitle: string;
  commitmentWarningMoney: string;
  commitmentWarningDetails: string;
  commitmentWarningTranscript: string;
  commitmentWarningQuotesLabel: string;
  resultsReassurance: string;
  startOverButton: string;
  callbackTitle: string;
  callbackSubtitle: string;
  callbackPhoneLabel: string;
  callbackButton: string;
  callbackCalling: string;
  callbackDone: string;
  callbackError: string;
};

export const EN: UIStrings = {
  eyebrow: "A kinder way to make the call",
  headlineLine1: "You say what you need.",
  headlineLine2: "We make the call.",
  subhead:
    "Tell us what you need, in any language. Warmline calls the business, gets a real answer, and gives it back to you in writing. You approve every call before it happens. The whole thing is typed and read, so you never have to hear or speak on a call. Built for Deaf and hard-of-hearing callers, non-native speakers, and anyone who finds phone calls hard.",
  trustDisclosed: "AI-disclosed on every call",
  trustApprove: "You approve first",

  stepIntake: "What you need",
  stepReview: "Review",
  stepResult: "Result",
  progressAriaLabel: "Progress",

  screen1Title: "What do you need help with?",
  screen1Subtitle: "Tell us in your own words. Any language is fine.",
  intentLabel: "What you want handled",
  intentPlaceholder: 'e.g. "quiero una cita con mi dentista lo antes posible"',
  speakRequestButton: "Say it instead",
  speakRequestHint: "Speak in any language. We'll write it down and switch the page to match.",
  speakRecordingButton: "Listening… tap to stop",
  speakTranscribingButton: "Writing down what you said…",
  speakHeardLanguagePrefix: "Heard in",
  errorMicDenied: "We could not use your microphone. You can type your request instead.",
  errorTranscribeFailed: "That recording could not be turned into text. Please try again, or type it instead.",
  errorNothingHeard: "We could not hear anything. Try again a little closer to the microphone.",
  detectLanguageButton: "Show this page in my language",
  showThisPageInPrefix: "Show this page in",
  detectingLanguageButton: "Detecting your language…",
  resultsInEnglishToggle: "View in English",
  resultsInMyLanguageToggle: "View in my language",
  themeToDarkLabel: "Switch to dark",
  themeToLightLabel: "Switch to light",
  yourLanguageLabel: "Your language",
  callLanguageLabel: "Call in a different language (optional)",
  callLanguageSameOption: "Same as my language",
  callerNameLabel: "Your name (optional)",
  callerNamePlaceholder: "Maria Ruiz",
  callerNameHint:
    "Only needed if you want Warmline to book for you. Leave it blank and it will just ask, and report back what is available.",
  targetsTitle: "Who should we call?",
  businessNameLabel: "Business name",
  businessNamePlaceholder: "Dr. Smith Dental",
  phoneLabel: "Phone number (E.164)",
  phonePlaceholder: "+12025550123",
  removeButton: "Remove",
  addAnotherButton: "Add another business",
  disclosureText:
    "I understand an AI assistant will call on my behalf and will say it is an AI. It will never pay, give card details, or agree to a fee.",
  bookingConsentText:
    "I give consent for Warmline to book an appointment for me, in my name, within the times I approve on the next screen.",
  bookingConsentHint:
    "Leave this unticked and Warmline will only ask and report back, without booking anything.",
  errorBookingNeedsName: "Add your name above so we know who to book the appointment under.",
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
  planReassurance:
    "You have agreed Warmline can book one appointment inside the times above, in your name. It will never pay, give card details, or agree to a deposit or fee. If money is needed, it stops and tells you.",
  planReassuranceNoBooking:
    "Warmline will only ask and report back. It will not book, pay, or commit to anything on this call.",
  errorRunFailed: "The mission could not run.",
  backButton: "Back",
  preparingCallButton: "Preparing the call…",
  makeCallButton: "Make the call",

  screen3Title: "Here's what we found",
  modeLabel: "Mode:",
  bestAnswerBadge: "Best answer",
  confidenceLabel: "Confidence:",
  followUpLabel: "Follow-up:",
  commitmentWarningTitle: "Please check this call",
  commitmentWarningMoney:
    "The assistant reported agreeing to a charge. It is not supposed to do that. Contact the business directly to check what, if anything, you owe.",
  commitmentWarningDetails:
    "The assistant reported giving out card or account details. It is not supposed to do that. Contact the business, and your bank if anything looks wrong.",
  commitmentWarningTranscript:
    "Money came up on this call. The assistant says it did not agree to anything, but you were not there, so check the wording below.",
  commitmentWarningQuotesLabel: "What was said:",
  resultsReassurance:
    "Nothing was paid for. If an appointment was booked, the details are above -- check them, and cancel with the business directly if they are wrong.",
  startOverButton: "Start over",
  callbackTitle: "Prefer to hear it?",
  callbackSubtitle: "Warmline can call you and read these results out loud, in your language.",
  callbackPhoneLabel: "Your phone number",
  callbackButton: "Call me with the results",
  callbackCalling: "Calling you…",
  callbackDone: "Done. Warmline is calling you now with the results.",
  callbackError: "That callback could not be completed. Please try again."
};
