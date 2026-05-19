import { test, expect, vi } from "vitest";
import { makeLlm } from "@/lib/llm/anthropic";

test("complete sends cached system block and returns text", async () => {
  const create = vi.fn(async () => ({ content: [{ type: "text", text: "hello" }] }));
  const llm = makeLlm({ messages: { create } } as any, "claude-haiku-4-5");
  const out = await llm.complete("SYS", "USER");
  expect(out).toBe("hello");
  const arg = create.mock.calls[0][0];
  expect(arg.system[0].cache_control).toEqual({ type: "ephemeral" });
  expect(arg.model).toBe("claude-haiku-4-5");
});
