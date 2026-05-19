import { test, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { signAscToken, ascKeyFromEnv } from "@/lib/asc/jwt";

test("signAscToken produces a verifiable ES256 token", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const token = signAscToken({ keyId: "KID", issuerId: "ISS", privateKey });
  const decoded = jwt.verify(token, publicKey, { algorithms: ["ES256"] }) as Record<string, unknown>;
  expect(decoded.iss).toBe("ISS");
  expect(decoded.aud).toBe("appstoreconnect-v1");
  const header = JSON.parse(Buffer.from(token.split(".")[0], "base64").toString());
  expect(header.kid).toBe("KID");
  expect(header.alg).toBe("ES256");
});

test("ascKeyFromEnv converts literal \\n to real newlines", () => {
  const key = ascKeyFromEnv({
    ASC_KEY_ID: "kid",
    ASC_ISSUER_ID: "iss",
    ASC_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nABCD\\n-----END PRIVATE KEY-----",
  });
  expect(key.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nABCD\n-----END PRIVATE KEY-----");
  expect(key.keyId).toBe("kid");
  expect(key.issuerId).toBe("iss");
});
