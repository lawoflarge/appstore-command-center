import jwt from "jsonwebtoken";

export interface AscKey { keyId: string; issuerId: string; privateKey: string; }

export function signAscToken(key: AscKey): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: key.issuerId, iat: now, exp: now + 19 * 60, aud: "appstoreconnect-v1" },
    key.privateKey,
    { algorithm: "ES256", header: { alg: "ES256", kid: key.keyId, typ: "JWT" } },
  );
}

export function ascKeyFromEnv(e: {
  ASC_KEY_ID: string; ASC_ISSUER_ID: string; ASC_PRIVATE_KEY: string;
}): AscKey {
  return {
    keyId: e.ASC_KEY_ID,
    issuerId: e.ASC_ISSUER_ID,
    // env stores newlines as literal \n
    privateKey: e.ASC_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
}
