import { test, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { signAscToken } from "@/lib/asc/jwt";

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
