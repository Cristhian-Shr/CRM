/**
 * Diagnóstico (somente leitura) do sync da Meta: replica CADA chamada que
 * syncMetaConnection faz e reporta qual quebra. Não grava nada.
 *
 *   set -a; . ./.env.local; set +a; tsx scripts/meta-diag.ts [COMPANY_ID]
 */
import { createDecipheriv, createHash } from "node:crypto";
import { Pool } from "pg";

const COMPANY_ID = process.argv[2] ?? process.env.COMPANY_ID;
const GRAPH = "https://graph.facebook.com/v21.0";

function decrypt(payload: string) {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY não configurada");
  const key = createHash("sha256").update(k).digest();
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

async function call(label: string, path: string, token: string, params: Record<string, string>) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  const json: any = await res.json();
  if (json.error) {
    console.log(`❌ ${label}\n   -> ${json.error.message} (code ${json.error.code}, type ${json.error.type})`);
  } else {
    const n = Array.isArray(json.data) ? json.data.length : 1;
    const sample = Array.isArray(json.data) ? json.data[0] : json;
    console.log(`✅ ${label}  (${n} ${Array.isArray(json.data) ? "linha(s)" : "obj"})  chaves: ${sample ? Object.keys(sample).slice(0, 12).join(", ") : "(vazio)"}`);
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const where = COMPANY_ID ? "where company_id = $1" : "";
  const { rows } = await pool.query(
    `select ad_account_id, page_id, access_token_enc, account_name, last_error, last_sync_at from meta_connections ${where} order by last_sync_at desc nulls last limit 1`,
    COMPANY_ID ? [COMPANY_ID] : [],
  );
  if (!rows.length) { console.log("Nenhuma conexão Meta."); await pool.end(); return; }
  const c = rows[0];
  const token = decrypt(c.access_token_enc);
  const acct = c.ad_account_id;
  console.log(`Conta: ${c.account_name ?? acct} (${acct})  pageId=${c.page_id ?? "—"}`);
  console.log(`last_sync_at: ${c.last_sync_at}`);
  console.log(`last_error no banco: ${c.last_error ?? "(nenhum)"}\n`);

  // Replica, na ordem, cada chamada do syncMetaConnection:
  await call("1. account info", acct, token, { fields: "name,currency,account_status,balance,spend_cap,funding_source_details" });
  if (c.page_id) await call("2. page name", c.page_id, token, { fields: "name" });
  await call("3. campaigns", `${acct}/campaigns`, token, { fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time", limit: "5" });
  await call("4. adsets", `${acct}/adsets`, token, { fields: "id,name,status,campaign_id,daily_budget,lifetime_budget", limit: "5" });
  await call("5. ads+creative", `${acct}/ads`, token, { fields: "id,name,status,adset_id,campaign_id,creative{id,thumbnail_url,title,body,effective_instagram_media_id,effective_object_story_id}", limit: "5" });
  await call("5b. ads creative (sem effective_*)", `${acct}/ads`, token, { fields: "id,name,status,adset_id,campaign_id,creative{id,thumbnail_url,title,body}", limit: "5" });
  await call("6. campaign insights", `${acct}/insights`, token, { level: "campaign", time_increment: "1", date_preset: "last_7d", fields: "campaign_id,spend,impressions,reach,clicks,actions", limit: "5" });
  await call("7. ad insights", `${acct}/insights`, token, { level: "ad", time_increment: "1", date_preset: "last_30d", fields: "ad_id,adset_id,campaign_id,spend,impressions,reach,clicks,inline_link_clicks,actions", limit: "5" });

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
