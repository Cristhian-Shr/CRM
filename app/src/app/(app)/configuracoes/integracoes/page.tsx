import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { Field, Form, Submit } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listMembers } from "@/lib/db/tenant";
import { fmtDateTime } from "@/lib/utils";
import { disconnectWhatsapp, saveMeta, saveWhatsapp } from "@/server/actions/settings";

export const metadata = { title: "Integrações" };

export default async function IntegrationsPage() {
  const ctx = await getContext();
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const [wa, metas, members] = await Promise.all([
    db.query.whatsappAccounts.findFirst({ where: eq(schema.whatsappAccounts.companyId, ctx.companyId) }),
    db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId)),
    listMembers(ctx.companyId),
  ]);

  return (
    <>
      <PageHeader title="Integrações" subtitle="WhatsApp Cloud API e Meta Ads" />
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">WhatsApp</h2>
            <span className={`badge ${wa?.status === "connected" ? "bg-green-50 text-green-700" : "bg-zinc-100 text-zinc-600"}`}>
              {wa?.status === "connected" ? "Conectado" : "Não conectado"}
            </span>
          </div>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>No Meta for Developers, crie um app e adicione o produto WhatsApp.</li>
            <li>Registre o número da clínica e gere um token de System User com as permissões whatsapp_business_messaging e whatsapp_business_management.</li>
            <li>Cole abaixo o Phone Number ID, o WABA ID e o token.</li>
            <li>
              Em WhatsApp → Configuração → Webhook, use a URL <code className="rounded bg-canvas px-1 text-ink">{base}/api/webhooks/whatsapp</code>, o token de
              verificação definido em WHATSAPP_VERIFY_TOKEN e assine o campo <b>messages</b>.
            </li>
          </ol>
          <Form action={saveWhatsapp} resetOnSuccess={false}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Número exibido">
                <input name="displayPhone" defaultValue={wa?.displayPhone ?? ""} className="input" placeholder="+55 51 99999-8888" />
              </Field>
              <Field label="Phone Number ID">
                <input name="phoneNumberId" required defaultValue={wa?.phoneNumberId ?? ""} className="input" />
              </Field>
              <Field label="WABA ID">
                <input name="wabaId" defaultValue={wa?.wabaId ?? ""} className="input" />
              </Field>
              <Field label="Quem recebe os leads novos">
                <select name="defaultOwnerId" defaultValue={wa?.defaultOwnerId ?? ""} className="input">
                  <option value="">Primeira vendedora</option>
                  {members
                    .filter((m) => m.active)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <Field label="Token de acesso">
              <input name="token" type="password" className="input" placeholder={wa?.accessTokenEnc ? "•••••• (deixe vazio para manter)" : ""} />
            </Field>
            <div className="flex gap-2">
              <Submit>Salvar conexão</Submit>
            </div>
          </Form>
          {wa?.status === "connected" && (
            <form action={disconnectWhatsapp} className="mt-2">
              <button className="btn-ghost text-xs text-red-600">Desconectar</button>
            </form>
          )}
        </section>

        <section className="card p-5">
          <h2 className="mb-4 text-lg font-semibold">Meta Ads (campanhas e formulários)</h2>
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>No Gerenciador de Negócios, crie um System User com acesso à conta de anúncios e gere um token com ads_read e leads_retrieval.</li>
            <li>Cole o ID da conta (act_...) e o token. As campanhas atualizam a cada 3 horas ou pelo botão em Campanhas Meta.</li>
            <li>
              Para receber leads de formulário, informe o ID da página e assine o campo <b>leadgen</b> no webhook da página com a URL{" "}
              <code className="rounded bg-canvas px-1 text-ink">{base}/api/webhooks/meta-leads</code>.
            </li>
          </ol>
          {metas.map((m) => (
            <div key={m.id} className="mb-3 rounded-xl border border-line p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{m.adAccountId}</span>
                <span className={m.status === "error" ? "text-red-600" : "text-green-700"}>{m.status === "error" ? "Erro" : "Conectada"}</span>
              </div>
              <div className="text-xs text-muted">
                Página: {m.pageId ?? "—"} · Última sincronização: {m.lastSyncAt ? fmtDateTime(m.lastSyncAt) : "nunca"}
              </div>
              {m.lastError && <div className="mt-1 text-xs text-red-600">{m.lastError}</div>}
            </div>
          ))}
          <Form action={saveMeta}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID da conta de anúncios">
                <input name="adAccountId" required className="input" placeholder="act_123456789" />
              </Field>
              <Field label="ID da página (formulários)">
                <input name="pageId" className="input" />
              </Field>
            </div>
            <Field label="Token de acesso">
              <input name="token" type="password" className="input" placeholder="Obrigatório na primeira conexão" />
            </Field>
            <Submit>Conectar conta</Submit>
          </Form>
        </section>
      </div>
    </>
  );
}
