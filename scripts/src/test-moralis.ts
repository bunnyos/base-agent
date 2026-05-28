import { Client } from "pg";
import { createDecipheriv, hkdfSync } from "node:crypto";

const ENC_PREFIX = "enc:v1:";

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function decrypt(token: string): string {
  if (!token.startsWith(ENC_PREFIX)) return token;
  const ikm = Buffer.from(process.env["SESSION_SECRET"]!, "utf8");
  const key = Buffer.from(
    hkdfSync("sha256", ikm, Buffer.alloc(0), "bunny/at-rest/v1", 32),
  );
  const [ivS, tagS, ctS] = token.slice(ENC_PREFIX.length).split(":") as [
    string,
    string,
    string,
  ];
  const iv = fromB64url(ivS);
  const tag = fromB64url(tagS);
  if (iv.length !== 12) throw new Error("invalid IV length");
  if (tag.length !== 16) throw new Error("invalid auth tag length");
  const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(fromB64url(ctS)), d.final()]).toString("utf8");
}

const BASE_URL = "https://deep-index.moralis.io/api/v2.2";
const WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CBETH_BASE = "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22";

interface Test {
  name: string;
  path: string;
  query?: Record<string, string | string[]>;
}

const TESTS: Test[] = [
  { name: "moralis_wallet_history", path: `/wallets/${WALLET}/history`, query: { limit: "3" } },
  { name: "moralis_wallet_tokens", path: `/wallets/${WALLET}/tokens` },
  { name: "moralis_wallet_native_balance", path: `/${WALLET}/balance` },
  { name: "moralis_wallet_nfts", path: `/${WALLET}/nft`, query: { format: "decimal", limit: "3" } },
  { name: "moralis_wallet_defi_positions", path: `/wallets/${WALLET}/defi/positions` },
  { name: "moralis_wallet_defi_summary", path: `/wallets/${WALLET}/defi/summary` },
  { name: "moralis_wallet_profitability", path: `/wallets/${WALLET}/profitability/summary` },
  { name: "moralis_token_metadata", path: `/erc20/metadata`, query: { addresses: [USDC_BASE, CBETH_BASE] } },
  { name: "moralis_token_holders", path: `/erc20/${USDC_BASE}/owners`, query: { limit: "3" } },
  { name: "moralis_token_price", path: `/erc20/${USDC_BASE}/price` },
];

function buildUrl(path: string, query: Record<string, string | string[]> = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const i of v) url.searchParams.append(k, i);
    else url.searchParams.set(k, v);
  }
  if (!url.searchParams.get("chain")) url.searchParams.set("chain", "base");
  return url.toString();
}

async function main() {
  const client = new Client({
    connectionString: process.env["NEON_DATABASE_URL"] ?? process.env["DATABASE_URL"],
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const res = await client.query<{ moralis_api_key: string | null }>(
    "select moralis_api_key from user_settings where moralis_api_key is not null limit 1",
  );
  await client.end();
  const row = res.rows[0];
  if (!row?.moralis_api_key) {
    console.error("No moralis_api_key found in user_settings — set one in Configure → llm first.");
    process.exit(1);
  }
  const apiKey = decrypt(row.moralis_api_key);
  console.log(`Loaded Moralis key (${apiKey.length} chars, ${apiKey.slice(0, 6)}…${apiKey.slice(-4)})\n`);

  let pass = 0;
  let fail = 0;
  for (const t of TESTS) {
    const url = buildUrl(t.path, t.query);
    const started = Date.now();
    try {
      const resp = await fetch(url, {
        headers: { "X-API-Key": apiKey, accept: "application/json" },
      });
      const ms = Date.now() - started;
      const text = await resp.text();
      if (!resp.ok) {
        fail++;
        console.log(`✗ ${t.name.padEnd(34)} ${resp.status} (${ms}ms) — ${text.slice(0, 200)}`);
        continue;
      }
      let summary = "";
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j)) summary = `array[${j.length}]`;
        else if (j.result && Array.isArray(j.result)) summary = `result[${j.result.length}]`;
        else if (j.usdPrice !== undefined) summary = `usdPrice=${j.usdPrice}`;
        else if (j.balance !== undefined) summary = `balance=${j.balance}`;
        else if (j.total_usd_value !== undefined) summary = `total_usd_value=${j.total_usd_value}`;
        else summary = Object.keys(j).slice(0, 5).join(",");
      } catch {
        summary = `${text.length} bytes`;
      }
      pass++;
      console.log(`✓ ${t.name.padEnd(34)} 200 (${ms}ms) ${summary}`);
    } catch (err) {
      fail++;
      const m = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${t.name.padEnd(34)} threw — ${m}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
