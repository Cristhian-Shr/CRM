import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Empty, PageHeader } from "@/components/ui";
import Link from "next/link";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/utils";
import { type TrafegoSearch } from "@/lib/trafego";
import { syncMetaNow } from "@/server/actions/campaigns";
import { BackfillButton } from "./backfill-button";
import { TrafegoFilters } from "./trafego-filters";
import { Tabs } from "./tabs";
import { ResumoTab } from "./_tabs/resumo";
import { CampanhasTab } from "./_tabs/campanhas";
import { CriativosTab } from "./_tabs/criativos";
import { WhatsappTab } from "./_tabs/whatsapp";
import { VinculosTab } from "./_tabs/vinculos";
import { AlertaSaldoTab } from "./_tabs/alerta-saldo";

export const metadata = { title: "Tráfego pago" };
// Folga para a importação de histórico (server action), que percorre vários meses.
export const maxDuration = 60;

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<TrafegoSearch> }) {
  const ctx = await getContext();
  if (!can(ctx, "campaigns.view")) redirect("/dashboard");
  const sp = await searchParams;
  const aba = sp.aba ?? "resumo";

  const conns = await db.select().from(schema.metaConnections).where(eq(schema.metaConnections.companyId, ctx.companyId));
  if (!conns.length)
    return (
      <>
        <PageHeader title="Tráfego pago" />
        <Empty>
          Conecte a conta de anúncios da Meta em{" "}
          <Link href="/configuracoes/integracoes" className="text-brand-600 underline">
            Configurações → Integrações
          </Link>{" "}
          para ver investimento, leads e retorno de cada campanha.
        </Empty>
      </>
    );

  const campaigns = await db.select({ id: schema.metaCampaigns.metaCampaignId, name: schema.metaCampaigns.name }).from(schema.metaCampaigns).where(eq(schema.metaCampaigns.companyId, ctx.companyId));
  const lastSync = conns.map((c) => c.lastSyncAt).filter(Boolean).sort().at(-1);
  const query = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== "aba" && v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Tráfego pago"
        subtitle={`Meta Ads (somente leitura) cruzado com leads, agendamentos e vendas do CRM. ${lastSync ? `Última coleta em ${fmtDateTime(lastSync)}` : "ainda não sincronizado"}`}
        actions={
          <>
            <BackfillButton />
            <ActionButton action={syncMetaNow} className="btn-primary">
              Atualizar agora
            </ActionButton>
          </>
        }
      />
      <TrafegoFilters contas={conns.map((c) => ({ id: c.id, name: c.accountName ?? c.adAccountId }))} campanhas={campaigns} />
      <Tabs active={aba} query={query ? `&${query}` : ""} />
      {aba === "resumo" && <ResumoTab ctx={ctx} sp={sp} />}
      {aba === "campanhas" && <CampanhasTab ctx={ctx} sp={sp} />}
      {aba === "criativos" && <CriativosTab ctx={ctx} sp={sp} />}
      {aba === "whatsapp" && <WhatsappTab ctx={ctx} sp={sp} />}
      {aba === "vinculos" && <VinculosTab ctx={ctx} sp={sp} conns={conns} />}
      {aba === "alerta" && <AlertaSaldoTab ctx={ctx} conns={conns} />}
    </>
  );
}
