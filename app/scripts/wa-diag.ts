/**
 * Diagnóstico (somente leitura) da conexão de WhatsApp de uma empresa.
 * Usa o token salvo para perguntar à Meta o que ele enxerga. NÃO envia mensagens.
 *
 *   COMPANY_ID=... tsx scripts/wa-diag.ts
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

async function get(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  return { status: res.status, json };
}

async function main() {
  if (!COMPANY_ID) throw new Error("Informe o COMPANY_ID.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(`select phone_number_id, waba_id, access_token_enc from whatsapp_accounts where company_id = $1`, [COMPANY_ID]);
  const acc = rows[0];
  if (!acc) throw new Error("Empresa sem conta de WhatsApp.");
  const token = decrypt(acc.access_token_enc);

  console.log("Phone Number ID salvo:", acc.phone_number_id);
  console.log("WABA ID salvo:        ", acc.waba_id);
  console.log("─".repeat(60));

  const probes: [string, string][] = [
    ["Quem é o token (/me)", `${GRAPH}/me?fields=id,name`],
    ["Permissões concedidas ao token", `${GRAPH}/me/permissions`],
    ["GET no Phone Number ID salvo", `${GRAPH}/${acc.phone_number_id}?fields=id,display_phone_number,verified_name`],
    ["Negócios (businesses) do token", `${GRAPH}/me/businesses?fields=id,name`],
  ];

  for (const [label, url] of probes) {
    const { status, json } = await get(url, token);
    console.log(`\n▶ ${label}  [HTTP ${status}]`);
    console.log(JSON.stringify(json, null, 2));
  }

  // Descobre as WABAs e os números reais acessíveis, negócio por negócio.
  const biz = await get(`${GRAPH}/me/businesses?fields=id,name`, token);
  const businesses: { id: string; name: string }[] = biz.json?.data ?? [];
  for (const b of businesses) {
    for (const kind of ["owned_whatsapp_business_accounts", "client_whatsapp_business_accounts"]) {
      const wabas = await get(`${GRAPH}/${b.id}/${kind}?fields=id,name`, token);
      const list: { id: string; name: string }[] = wabas.json?.data ?? [];
      for (const w of list) {
        const nums = await get(`${GRAPH}/${w.id}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
        console.log(`\n✅ WABA "${w.name}" — WABA ID: ${w.id}  (negócio: ${b.name})`);
        console.log("   Números:", JSON.stringify(nums.json?.data ?? nums.json, null, 2));
      }
    }
  }
  await pool.end();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
