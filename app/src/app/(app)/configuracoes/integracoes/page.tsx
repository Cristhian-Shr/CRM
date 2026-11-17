import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { Field, Form, Submit } from "@/components/form";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { listMembers } from "@/lib/db/tenant";
import { fmtDateTime } from "@/lib/utils";
import { WhatsappTest } from "@/components/integrations/whatsapp-test";
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
          <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>
              Acesse <b>developers.facebook.com</b> → <b>Meus Apps</b>, abra o app da clínica (ou crie um e adicione o produto <b>WhatsApp</b>) e registre o
              número da clínica — ele precisa estar <b>verificado</b>.
            </li>
            <li>
              No menu esquerdo, vá em <b>WhatsApp → Configuração da API</b>. Nessa tela copie:
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  <b>Phone Number ID</b> — campo <i>“Identificação do número de telefone”</i>. É um <b>número longo</b> (ex.: 123456789012345),{" "}
                  <b>não</b> o +55.
                </li>
                <li>
                  <b>WABA ID</b> — campo <i>“Identificação da conta do WhatsApp Business”</i>, logo abaixo.
                </li>
              </ul>
            </li>
            <li>
              Em <b>Gerenciador de Negócios → Usuários do sistema</b>, gere um token de <b>System User</b> com as permissões{" "}
              <code className="rounded bg-canvas px-1 text-ink">whatsapp_business_messaging</code> e{" "}
              <code className="rounded bg-canvas px-1 text-ink">whatsapp_business_management</code>.
            </li>
            <li>
              Cole abaixo o <b>Phone Number ID</b>, o <b>WABA ID</b> e o <b>token</b>, informe o nome do template aprovado e clique em <b>Salvar conexão</b>.
            </li>
            <li>
              Em <b>WhatsApp → Configuração → Webhook</b>, use a URL <code className="rounded bg-canvas px-1 text-ink">{base}/api/webhooks/whatsapp</code>, o
              token de verificação definido em WHATSAPP_VERIFY_TOKEN e assine o campo <b>messages</b>.
            </li>
            <li>
              Clique em <b>Testar conexão</b> para confirmar que o número, o token e o template de confirmação estão válidos na Meta.
            </li>
          </ol>
          <Form action={saveWhatsapp} resetOnSuccess={false}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Número exibido">
                <input name="displayPhone" defaultValue={wa?.displayPhone ?? ""} className="input" placeholder="+55 51 99999-8888" />
              </Field>
              <Field label="Phone Number ID">
                <input name="phoneNumberId" required defaultValue={wa?.phoneNumberId ?? ""} className="input" placeholder="123456789012345" />
                <p className="mt-1 text-xs text-muted">WhatsApp → Configuração da API · “Identificação do número de telefone” (não é o +55).</p>
              </Field>
              <Field label="WABA ID">
                <input name="wabaId" defaultValue={wa?.wabaId ?? ""} className="input" />
                <p className="mt-1 text-xs text-muted">Mesma tela · “Identificação da conta do WhatsApp Business”.</p>
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
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="mb-2 text-sm font-medium">Confirmação de agenda</p>
              <p className="mb-3 text-xs text-muted">
                Nome e idioma do template aprovado na Meta (categoria Utility) usado no lembrete da véspera. As variáveis do corpo recebem, nesta ordem: nome,
                data, hora e profissional. Deixe o nome vazio para não enviar lembretes.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome do template">
                  <input name="confirmTemplateName" defaultValue={wa?.settings?.confirmTemplate?.name ?? ""} className="input" placeholder="confirmacao_agenda" />
                </Field>
                <Field label="Idioma">
                  <input name="confirmTemplateLang" defaultValue={wa?.settings?.confirmTemplate?.lang ?? "pt_BR"} className="input" placeholder="pt_BR" />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Submit>Salvar conexão</Submit>
              <WhatsappTest disabled={!wa?.accessTokenEnc} />
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
          <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-muted">
            <li>
              Pegue o <b>ID da conta de anúncios</b>: no <b>Gerenciador de Anúncios</b> (business.facebook.com), abra o seletor de contas no topo — o número
              aparece como <code className="rounded bg-canvas px-1 text-ink">act_123456789</code>. Também é possível ver em{" "}
              <b>Configurações do negócio → Contas → Contas de anúncios</b>.
            </li>
            <li>
              Só para receber <b>leads de formulário</b>: pegue o <b>ID da página</b> do Facebook. Abra a página → <b>Sobre / Transparência da página</b>, ou em{" "}
              <b>Configurações do negócio → Contas → Páginas</b>. É um número longo (ex.: 102938475610293).
            </li>
            <li>
              Gere o <b>token de acesso</b>: em <b>Configurações do negócio → Usuários → Usuários do sistema</b>, crie (ou use) um{" "}
              <b>Usuário do sistema</b>, dê a ele acesso à conta de anúncios e à página, e clique em <b>Gerar novo token</b> escolhendo o seu app. Marque as
              permissões:
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  <code className="rounded bg-canvas px-1 text-ink">ads_read</code> — ler campanhas e métricas.
                </li>
                <li>
                  <code className="rounded bg-canvas px-1 text-ink">leads_retrieval</code> — baixar os dados dos formulários.
                </li>
                <li>
                  <code className="rounded bg-canvas px-1 text-ink">pages_show_list</code> e{" "}
                  <code className="rounded bg-canvas px-1 text-ink">pages_manage_metadata</code> — necessárias só para assinar o webhook da página.
                </li>
              </ul>
              Use um token <b>permanente</b> (Usuário do sistema). Copie-o na hora: a Meta não mostra de novo.
            </li>
            <li>
              Cole o <b>ID da conta</b>, o <b>ID da página</b> (se for usar formulários) e o <b>token</b> nos campos abaixo e clique em <b>Conectar conta</b>. As
              campanhas sincronizam a cada 3 horas, ou na hora pelo botão em <b>Campanhas Meta</b>.
            </li>
            <li>
              Para receber os leads de formulário automaticamente, configure o webhook no app em{" "}
              <b>developers.facebook.com → seu app → Webhooks → Página</b>:
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>
                  <b>URL de callback:</b> <code className="rounded bg-canvas px-1 text-ink">{base}/api/webhooks/meta-leads</code>
                </li>
                <li>
                  <b>Token de verificação:</b> o mesmo valor definido em <code className="rounded bg-canvas px-1 text-ink">WHATSAPP_VERIFY_TOKEN</code> (o
                  webhook do Meta usa o mesmo token do WhatsApp).
                </li>
                <li>
                  Assine o campo <b>leadgen</b> e, na mesma tela, clique em <b>Subscribe</b> na página da clínica para ativar o envio.
                </li>
              </ul>
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
                <p className="mt-1 text-xs text-muted">Gerenciador de Anúncios · começa com “act_” (se esquecer o prefixo, o sistema adiciona).</p>
              </Field>
              <Field label="ID da página (formulários)">
                <input name="pageId" className="input" placeholder="102938475610293" />
                <p className="mt-1 text-xs text-muted">Opcional · só é preciso para receber leads de formulário pelo webhook.</p>
              </Field>
            </div>
            <Field label="Token de acesso">
              <input name="token" type="password" className="input" placeholder="Obrigatório na primeira conexão" />
              <p className="mt-1 text-xs text-muted">Token permanente de Usuário do sistema com ads_read e leads_retrieval. Deixe vazio para manter o atual.</p>
            </Field>
            <Submit>Conectar conta</Submit>
          </Form>
        </section>
      </div>
    </>
  );
}
