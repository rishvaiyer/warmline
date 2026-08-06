import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { baseMissionSchema, makeIdempotencyKey, parseAllowedPhoneNumbers } from "../src/domain/base.js";
import { getTemplate } from "../src/domain/registry.js";
import { interpretIntent } from "../src/domain/interpret.js";
import { translateMissionFields, translateResultStrings } from "../src/domain/translate.js";

const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
const port = Number(process.env.PORT || 8787);
const realCallsEnabled = process.env.ALLOW_REAL_CALLS === "true";
const allowedPhoneNumbers = parseAllowedPhoneNumbers(process.env.CALLE_ALLOWED_NUMBERS);
const inFlightKeys = new Set<string>();

app.get("/api/health", async () => ({
  ok: true,
  mode: "mock"
}));

app.post("/api/intent/interpret", async (request, reply) => {
  const body = request.body as { text?: unknown; userLocale?: unknown } | undefined;
  const text = typeof body?.text === "string" ? body.text : "";
  const userLocale = typeof body?.userLocale === "string" ? body.userLocale : "en-US";

  if (text.trim().length < 3) {
    return reply.code(400).send({ error: "Describe what you need in a bit more detail." });
  }

  const plan = interpretIntent(text, userLocale);
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

  // Allowlist + idempotency scaffolding kept in no-op-safe shape, mirroring
  // foundline/server/index.ts, so real calls can be wired in without
  // redesigning this route. None of it has an effect while realCallsEnabled
  // stays false, but it fails closed if it were ever reached.
  const disallowedTargets = mission.targets.filter(
    (target) => !allowedPhoneNumbers.has(target.phoneE164)
  );
  if (disallowedTargets.length > 0) {
    return reply.code(403).send({
      error: "Real call blocked. Every recipient must be included in the server-side CALLE_ALLOWED_NUMBERS list."
    });
  }
  const callLocale = mission.callLocale ?? mission.userLocale;
  // Boundary IN: translate free-text fields userLocale -> callLocale (no-op today).
  const localizedMission = translateMissionFields(mission, mission.userLocale, callLocale);
  for (const target of mission.targets) {
    const idempotencyKey = makeIdempotencyKey(mission.kind, mission.id, target.id);
    if (inFlightKeys.has(idempotencyKey)) {
      return reply.code(409).send({ error: `Duplicate call blocked for ${target.venueName}.` });
    }
  }

  // TODO: real CALL-E path. Construct a CalleClient (from "@call-e/calle"), call
  // template.buildCallTask(localizedMission, target) for each target, send it
  // through client.calls.createAndWait with template.resultSchema, normalize
  // with template.normalizeResult, then translate the result strings back with
  // translateResultStrings(result, callLocale, mission.userLocale) (boundary
  // OUT) before returning. Deliberately not implemented here: this scaffold
  // never imports "@call-e/calle" so the build never depends on its types.
  // See foundline/server/index.ts for the reference shape.
  request.log.info({ localizedMission, translateResultStrings: typeof translateResultStrings });
  throw new Error("real calls not implemented in scaffold");
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
