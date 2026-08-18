import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";

const TOKEN_BYTES = 32;

export async function createCapabilityToken(filePath: string): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const file = await open(filePath, "wx", 0o600);
  try {
    await file.writeFile(`${token}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  await chmod(filePath, 0o600);
  return token;
}

export async function readCapabilityToken(filePath: string): Promise<string> {
  const metadata = await stat(filePath);
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Capability token must not be group/world accessible: ${filePath}`);
  }
  const token = (await readFile(filePath, "utf8")).trim();
  if (token.length < 32) {
    throw new Error("Capability token is unexpectedly short");
  }
  return token;
}

export function tokenMatches(expected: string, authorization: string | undefined): boolean {
  if (authorization === undefined || !authorization.startsWith("Bearer ")) {
    return false;
  }
  const received = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes)
  );
}

