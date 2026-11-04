import { z } from "zod";

/**
 * Server-side environment. Parsed lazily so that `next build` and unit tests
 * can import modules without every secret being present.
 */
const envSchema = z.object({
  MISTRAL_API_KEY: z.string().min(1).optional(),
  MISTRAL_MODEL: z.string().default("mistral-large-latest"),

  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  ELASTICSEARCH_API_KEY: z.string().optional(),
  ELASTICSEARCH_USERNAME: z.string().optional(),
  ELASTICSEARCH_PASSWORD: z.string().optional(),
  ELASTICSEARCH_INDEX: z.string().default("sf311-cases"),
  /** Optional inference endpoint (e.g. ".elser-2-elastic") for semantic search over case descriptions. */
  ELASTICSEARCH_INFERENCE_ID: z.string().optional(),
  /** Closed-loop challenge data lives in its own indices, separate from the 311 mirror. */
  ELASTICSEARCH_CHALLENGES_INDEX: z.string().default("sf-challenges"),
  ELASTICSEARCH_OBSERVATIONS_INDEX: z.string().default("sf-observations"),

  /**
   * Dev-only "chat with the data" agent (sidebar). Points at a separate
   * Elastic project holding exemplary data, so the main index config above
   * stays untouched while interfaces are being developed.
   */
  ELASTIC_DEV_ENDPOINT: z.string().url().optional(),
  ELASTIC_DEV_API_KEY: z.string().optional(),
  /** Force the dev agent on/off regardless of NODE_ENV ("1" / "0"). */
  DEV_AGENT: z.string().optional(),

  SF_OPEN_DATA_APP_TOKEN: z.string().optional(),

  /** Comma-separated Overpass endpoints, tried in order. */
  OVERPASS_URL: z
    .string()
    .default("https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter"),

  QUEST_MOCK: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse({
    ...process.env,
    // Treat empty strings from .env files as unset.
    ...Object.fromEntries(
      Object.entries(process.env).map(([k, v]) => [k, v === "" ? undefined : v]),
    ),
  });
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

/** Dev agent is on in development by default, off in production unless DEV_AGENT=1. */
export function isDevAgentEnabled(): boolean {
  const flag = getEnv().DEV_AGENT;
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function requireMistralKey(): string {
  const key = getEnv().MISTRAL_API_KEY;
  if (!key) {
    throw new Error("MISTRAL_API_KEY is not set. Copy .env.example to .env.local and fill it in.");
  }
  return key;
}
