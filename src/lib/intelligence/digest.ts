export function isDigestDay(day: string): boolean {
  return new Date(day + "T00:00:00Z").getUTCDay() === 1; // Monday (UTC)
}

const SYS = `You are an ASO growth analyst. Given a JSON summary, write a concise
markdown weekly digest: what changed, why it likely happened, and a prioritized
3-item action list. No fluff, no preamble.`;

export async function buildDigest(
  llm: { complete: (s: string, u: string) => Promise<string> },
  summary: unknown,
): Promise<string> {
  return llm.complete(SYS, JSON.stringify(summary));
}
