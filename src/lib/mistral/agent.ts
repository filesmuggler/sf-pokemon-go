import { z } from "zod";
import { getMistralClient, getMistralModel } from "./client";
import { contentToText, runToolLoop, type Message } from "./loop";
import { getToolDefinitions, QUEST_TOOLS } from "./tools";
import { buildInvestigationPrompt, COMPOSER_SYSTEM_PROMPT, INVESTIGATOR_SYSTEM_PROMPT } from "./prompts";
import { QuestSchema, type AgentStep, type Quest, type QuestRequest, type QuestResponse } from "@/lib/quest/schema";

const MAX_TOOL_ROUNDS = 8;

/**
 * Runs the two-phase agent:
 *  1. Investigation — tool-calling loop over Elasticsearch-backed tools.
 *  2. Composition — one structured-output call that renders the Quest JSON.
 */
export async function runQuestAgent(req: QuestRequest): Promise<QuestResponse> {
  const mistral = getMistralClient();
  const model = getMistralModel();
  const trace: AgentStep[] = [];

  const messages: Message[] = [
    { role: "system", content: INVESTIGATOR_SYSTEM_PROMPT },
    { role: "user", content: buildInvestigationPrompt(req) },
  ];

  // Phase 1: investigate
  await runToolLoop({ model, messages, tools: getToolDefinitions(QUEST_TOOLS), trace, maxRounds: MAX_TOOL_ROUNDS });

  // Phase 2: compose structured quest
  const composeMessages: Message[] = [
    { role: "system", content: COMPOSER_SYSTEM_PROMPT },
    ...messages.slice(1),
    {
      role: "user",
      content: `Now output the quest as JSON. center must be {lat: ${req.lat}, lon: ${req.lon}} and radius_m must be ${req.radius_m}.`,
    },
  ];

  const composed = await mistral.chat.complete({
    model,
    messages: composeMessages,
    temperature: 0.3,
    responseFormat: {
      type: "json_schema",
      jsonSchema: {
        name: "quest",
        description: "A neighborhood side quest built from 311 data",
        schemaDefinition: z.toJSONSchema(QuestSchema),
        strict: true,
      },
    },
  });

  const raw = contentToText(composed.choices[0]?.message?.content);
  const quest = parseQuest(raw);

  return { quest, trace, model };
}

function parseQuest(raw: string): Quest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Composer did not return valid JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = QuestSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Quest failed schema validation: ${parsed.error.message}`);
  }
  // Normalize XP total rather than trusting the model's arithmetic.
  const total_xp = parsed.data.objectives.reduce((sum, o) => sum + o.xp, 0);
  return { ...parsed.data, total_xp };
}
