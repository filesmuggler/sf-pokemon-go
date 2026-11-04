import { z } from "zod";
import { getMistralClient, getMistralModel } from "./client";
import { contentToText, runToolLoop, type Message } from "./loop";
import { CHALLENGE_TOOLS, getToolDefinitions } from "./tools";
import { buildChallengePrompt, CHALLENGE_COMPOSER_SYSTEM_PROMPT, CHALLENGE_INVESTIGATOR_SYSTEM_PROMPT } from "./prompts";
import { ChallengeBatchSchema, type ChallengeBatch, type ChallengeRequest } from "@/lib/challenge/schema";
import type { AgentStep } from "@/lib/quest/schema";

/**
 * Challenge designer: same two-phase shape as the quest agent, but with the
 * OSM lookup and prior-observation tools so the loop can close.
 */
export async function runChallengeAgent(req: ChallengeRequest): Promise<{ batch: ChallengeBatch; trace: AgentStep[]; model: string }> {
  const mistral = getMistralClient();
  const model = getMistralModel();
  const trace: AgentStep[] = [];

  const messages: Message[] = [
    { role: "system", content: CHALLENGE_INVESTIGATOR_SYSTEM_PROMPT },
    { role: "user", content: buildChallengePrompt(req) },
  ];

  await runToolLoop({ model, messages, tools: getToolDefinitions(CHALLENGE_TOOLS), trace, maxRounds: 10 });

  const composed = await mistral.chat.complete({
    model,
    messages: [
      { role: "system", content: CHALLENGE_COMPOSER_SYSTEM_PROMPT },
      ...messages.slice(1),
      { role: "user", content: "Now output the challenge batch as JSON." },
    ],
    temperature: 0.3,
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "challenge_batch",
        description: "Closed-loop map challenges derived from 311 trends, OSM coverage and prior observations",
        schemaDefinition: z.toJSONSchema(ChallengeBatchSchema),
        strict: true,
      },
    },
  });

  const raw = contentToText(composed.choices[0]?.message?.content);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Composer did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = ChallengeBatchSchema.safeParse(json);
  if (!parsed.success) throw new Error(`Challenge batch failed schema validation: ${parsed.error.message}`);

  // Normalize: choices only make sense for choice answers.
  const batch: ChallengeBatch = {
    ...parsed.data,
    challenges: parsed.data.challenges.map((c) => ({ ...c, choices: c.answer_type === "choice" ? c.choices : [] })),
  };
  return { batch, trace, model };
}
