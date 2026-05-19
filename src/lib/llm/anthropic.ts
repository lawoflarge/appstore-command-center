import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

export function makeLlm(client: Anthropic, model: string) {
  return {
    async complete(system: string, user: string, maxTokens = 1500): Promise<string> {
      const res = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      } as any);
      const block = (res as any).content?.find((c: any) => c.type === "text");
      return block?.text ?? "";
    },
  };
}

export function llmFromEnv(model: string) {
  return makeLlm(new Anthropic({ apiKey: env().ANTHROPIC_API_KEY }), model);
}

export const MODELS = { cheap: "claude-haiku-4-5", smart: "claude-sonnet-4-6" };
