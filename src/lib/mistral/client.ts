import { Mistral } from "@mistralai/mistralai";
import { getEnv, requireMistralKey } from "@/lib/env";

let client: Mistral | null = null;

export function getMistralClient(): Mistral {
  if (client) return client;
  client = new Mistral({ apiKey: requireMistralKey() });
  return client;
}

export function getMistralModel(): string {
  return getEnv().MISTRAL_MODEL;
}
