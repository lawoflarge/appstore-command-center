import { z } from "zod";

const schema = z.object({
  ASC_KEY_ID: z.string().min(1),
  ASC_ISSUER_ID: z.string().min(1),
  ASC_PRIVATE_KEY: z.string().min(1),
  ASC_VENDOR_NUMBER: z.string().min(1),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
  AUTH_SECRET: z.string().min(1),
  ALLOWED_GITHUB_LOGIN: z.string().min(1),
  GITHUB_DATA_REPO: z.string().regex(/^[^/]+\/[^/]+$/),
  GITHUB_DATA_TOKEN: z.string().min(1),
  GITHUB_DATA_BRANCH: z.string().default("main"),
  CRON_SECRET: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

export function parseEnv(src: Record<string, string | undefined>): Env {
  return schema.parse(src);
}

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}
