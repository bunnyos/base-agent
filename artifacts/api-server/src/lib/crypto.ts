import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// AES-256-GCM at-rest encryption for sensitive settings (OpenRouter API key,
// Base MCP OAuth tokens). Key derived from SESSION_SECRET via HKDF so the
// encryption key is separate from the cookie-signing key but rotates together.
//
// Format: "enc:v1:<iv-b64url>:<tag-b64url>:<ct-b64url>"
// Reads use tryDecrypt which is lossless on legacy plaintext values, so
// existing rows continue to work and become encrypted on next write.

const ENC_PREFIX = "enc:v1:";

function getMasterSecret(): string {
  const s = process.env["SESSION_SECRET"];
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET is required (>=16 chars) for at-rest encryption.",
    );
  }
  return s;
}

let derivedKey: Buffer | null = null;
function getKey(): Buffer {
  if (derivedKey) return derivedKey;
  const ikm = Buffer.from(getMasterSecret(), "utf8");
  // HKDF-SHA256 -> 32 bytes for AES-256
  const out = hkdfSync("sha256", ikm, Buffer.alloc(0), "bunny/at-rest/v1", 32);
  derivedKey = Buffer.from(out);
  return derivedKey;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${b64url(iv)}:${b64url(tag)}:${b64url(ct)}`;
}

function decrypt(token: string): string {
  if (!token.startsWith(ENC_PREFIX)) {
    throw new Error("not an encrypted token");
  }
  const parts = token.slice(ENC_PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("malformed ciphertext");
  const [ivS, tagS, ctS] = parts as [string, string, string];
  const iv = fromB64url(ivS);
  const tag = fromB64url(tagS);
  const ct = fromB64url(ctS);
  if (iv.length !== 12) throw new Error("invalid IV length");
  if (tag.length !== 16) throw new Error("invalid auth tag length");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv, {
    authTagLength: 16,
  });
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// Lossless reader: returns plaintext if encrypted, otherwise returns input
// unchanged (legacy-row passthrough). Throws only if decryption fails on a
// value that looks encrypted (tamper/wrong key).
export function tryDecrypt(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;
  return decrypt(value);
}
