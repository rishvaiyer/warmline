import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { CalleClient } from "@call-e/calle";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  baseMissionSchema,
  makeIdempotencyKey,
  parseAllowedPhoneNumbers,
  type CallResult
} from "../src/domain/base.js";
import { getTemplate } from "../src/domain/registry.js";
import { interpretIntent } from "../src/domain/interpret.js";
import { translateMissionFields, translateResultStrings } from "../src/domain/translate.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const port = Number(process.env.PORT || 8787);
const allowedPhoneNumbers = parseAllowedPhoneNumbers(process.env.CALLE_ALLOWED_NUMBERS);
const calleRegion = process.env.CALLE_REGION || "US";

// Real calls require the explicit opt-in flag, a CALL-E API key, AND at least
// one server-side allowlisted number. If any of those is missing, the server
// stays in mock mode -- that is the default and the safe fallback.
const realCallsEnabled =
  process.env.ALLOW_REAL_CALLS === "true" &&
  Boolean(process.env.CALLE_API_KEY) &&
  allowedPhoneNumbers.size > 0;

const inFlightKeys = new Set<string>();

let calleClient: CalleClient | undefined;
function getCalleClient(): CalleClient {
  if (!calleClient) {
    calleClient = new CalleClient({ apiKey: process.env.CALLE_API_KEY as string });
  }
  return calleClient;
}

app.get("/api/health", async () => ({
  ok: true,
  mode: realCallsEnabled ? "real" : "mock",
  realCallsConfigured: realCallsEnabled,
  realCallProtection: realCallsEnabled ? "server_allowlist" : "disabled"
}));

app.post("/api/intent/interpret", async (request, reply) => {
  const body = request.body as { text?: unknown; userLocale?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text : "";
  const userLocale = typeof body?.userLocale === "string" ? body.userLocale : "en-US";

  if (text.trim().length < 3) {
    return reply.code(400).send({ error: "Describe what you need in a bit more detail." });
  }

  const plan = await interpretIntent(text, userLocale);
  return { plan };
});

app.post("/api/missions/run", async (request, reply) => {
  const base = baseMissionSchema.safeParse(request.body);
  if (!base.success) {
    return reply.code(400).send({
      error: "Mission validation failed",
      issues: base.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  let template;
  try {
    template = getTemplate(base.data.kind);
  } catch (error) {
    return reply.code(400).send({ error: String((error as Error).message) });
  }

  const parsed = template.intakeSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: "Mission validation failed",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message
      }))
    });
  }

  const mission = { ...base.data, ...(parsed.data as Record<string, unknown>) } as typeof base.data &
    Record<string, unknown>;

  try {
    template.guards?.(mission as never);
  } catch (error) {
    return reply.code(422).send({ error: String((error as Error).message) });
  }

  if (!realCallsEnabled) {
    return {
      missionId: mission.id,
      mode: "mock",
      results: mission.targets.map((_target, index) => template.mockResult(mission as never, index))
    };
  }

  const disallowedTargets = mission.targets.filter(
    (target) => !allowedPhoneNumbers.has(target.phoneE164)
  );
  if (disallowedTargets.length > 0) {
    return reply.code(403).send({
      error: "Real call blocked. Every recipient must be included in the server-side CALLE_ALLOWED_NUMBERS list."
    });
  }

  const callLocale = mission.callLocale ?? mission.userLocale;
  // Boundary IN: translate free-text fields userLocale -> callLocale (no-op when equal).
  const localizedMission = await translateMissionFields(mission, mission.userLocale, callLocale);

  const client = getCalleClient();
  const results: CallResult<unknown>[] = [];

  for (const target of mission.targets) {
    const idempotencyKey = makeIdempotencyKey(mission.kind, mission.id, target.id);
    if (inFlightKeys.has(idempotencyKey)) {
      return reply.code(409).send({ error: `Duplicate call blocked for ${target.venueName}.` });
    }

    inFlightKeys.add(idempotencyKey);
    try {
      const providerResult = await client.calls.createAndWait(
        {
          task: template.buildCallTask(localizedMission as never, target),
          recipient: { phone: target.phoneE164, region: calleRegion, locale: callLocale },
          resultSchema: template.resultSchema,
          metadata: {
            workflow: mission.kind,
            mission_id: mission.id,
            target_id: target.id,
            idempotency_key: idempotencyKey
          }
        },
        { idempotencyKey, timeoutMs: 10 * 60 * 1000 }
      );

      const normalized = template.normalizeResult(
        target,
        providerResult as unknown as Record<string, unknown>
      );
      // Boundary OUT: translate result strings callLocale -> userLocale (no-op when equal).
      const translated = await translateResultStrings(
        normalized as CallResult<unknown> & Record<string, unknown>,
        callLocale,
        mission.userLocale
      );
      results.push(translated);
    } catch (error) {
      request.log.error(error, `CALL-E failed for target ${target.id}`);
      results.push({
        targetId: target.id,
        venueName: target.venueName,
        status: "failed",
        outcome: "unknown",
        confidence: "low",
        evidence: [],
        followUpRequired: true,
        followUpInstructions: "The call did not complete. Review the error before retrying.",
        completedAt: new Date().toISOString(),
        data: {} as never
      });
    } finally {
      inFlightKeys.delete(idempotencyKey);
    }
  }

  return { missionId: mission.id, mode: "real", results };
});

const webRoot = resolve(process.cwd(), "dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    wildcard: false
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ port, host: "0.0.0.0" });
