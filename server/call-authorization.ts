import { createHash, timingSafeEqual } from "node:crypto";

interface CallAuthorizationOptions {
  enabled: boolean;
  ownerToken?: string;
  allowedNumbers?: string;
  now?: () => number;
}

interface CallRefusal {
  status: 401 | 403 | 429 | 503;
  error: string;
  retryAfter?: number;
}

const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALL_ATTEMPTS = 10;

export function createCallAuthorization(options: CallAuthorizationOptions) {
  const now = options.now ?? Date.now;
  const ownerToken = options.ownerToken ?? "";
  const configured = /^[\x21-\x7e]{32,512}$/.test(ownerToken);
  const expected = createHash("sha256").update(ownerToken).digest();
  const allowed = new Set(
    (options.allowedNumbers ?? "").split(",").map((phone) => phone.trim())
      .filter((phone) => /^\+[1-9]\d{7,14}$/.test(phone))
  );
  let attempts: number[] = [];

  return function authorize(
    authorization: string | undefined,
    phones: readonly string[]
  ): CallRefusal | undefined {
    if (!options.enabled) return;
    if (!configured || allowed.size === 0) {
      return { status: 503, error: "Real calls need owner authorization and an allowed-number configuration." };
    }
    const supplied = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!supplied || supplied.length > 512 ||
        !timingSafeEqual(createHash("sha256").update(supplied).digest(), expected)) {
      return { status: 401, error: "Owner authorization is required for real calls." };
    }
    if (phones.length < 1 || phones.length > 5 || phones.some((phone) => !allowed.has(phone))) {
      return { status: 403, error: "Every recipient must be in the server's allowed-number list." };
    }
    const time = now();
    attempts = attempts.filter((attempt) => time - attempt < WINDOW_MS);
    if (attempts.length + phones.length > MAX_CALL_ATTEMPTS) {
      return {
        status: 429,
        error: "Real-call limit reached. Try again after the current window ends.",
        retryAfter: Math.max(1, Math.ceil((attempts[0] + WINDOW_MS - time) / 1000))
      };
    }
    attempts.push(...phones.map(() => time));
  };
}
