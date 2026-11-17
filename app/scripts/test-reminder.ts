/**
 * Envio PONTUAL de confirmação de agenda para UM agendamento (teste).
 * Replica o que o cron faz, mas só para o appointment id passado — não varre
 * os demais e não dispara mensagens para outras clínicas.
 *
 *   APPT_ID=... (ou 1º argumento)  tsx scripts/test-reminder.ts
 */
import { createDecipheriv, createHash } from "node:crypto";
import { Pool } from "pg";

const APPT_ID = process.argv[2] ?? process.env.APPT_ID;
const TZ = "America/Sao_Paulo";

/** Mesmo esquema do app (src/lib/crypto.ts): AES-256-GCM, key = sha256(ENCRYPTION_KEY). */
function decrypt(payload: string) {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error("ENCRYPTION_KEY não configurada");
  const key = createHash("sha256").update(k).digest();
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

async function main() {
  if (!APPT_ID) throw new Error("Informe o APPT_ID (argumento ou env).");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `select a.id, a.starts_at, c.name as contato, coalesce(c.whatsapp, c.phone) as to_phone,
            wa.phone_number_id, wa.access_token_enc, wa.settings,
            u.name as professional
       from appointments a
       join contacts c on c.id = a.contact_id
       join whatsapp_accounts wa on wa.company_id = a.company_id
       left join company_members cm on cm.id = a.professional_id
       left join users u on u.id = cm.user_id
      where a.id = $1`,
    [APPT_ID],
  );
  const r = rows[0];
  if (!r) throw new Error("Agendamento não encontrado.");
  if (!r.phone_number_id || !r.access_token_enc) throw new Error("Clínica sem WhatsApp conectado.");
  const tpl = r.settings?.confirmTemplate;
  if (!tpl?.name) throw new Error("Template de confirmação não configurado.");
  if (!r.to_phone) throw new Error("Contato sem telefone/WhatsApp.");

  const token = decrypt(r.access_token_enc);
  const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...opts }).format(new Date(r.starts_at));
  const params = [r.contato, fmt({ day: "2-digit", month: "2-digit" }), fmt({ hour: "2-digit", minute: "2-digit" }), r.professional ?? "a definir"];

  console.log("Enviando para:", r.to_phone, "| template:", tpl.name, tpl.lang, "| params:", params);

  const res = await fetch(`https://graph.facebook.com/v21.0/${r.phone_number_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: String(r.to_phone).replace(/^\+/, ""),
      type: "template",
      template: {
        name: tpl.name,
        language: { code: tpl.lang },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
      },
    }),
  });
  const json = await res.json();
  console.log("HTTP", res.status);
  console.log(JSON.stringify(json, null, 2));
  await pool.end();
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
