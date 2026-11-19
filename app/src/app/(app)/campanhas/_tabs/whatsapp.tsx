import { sql } from "drizzle-orm";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { money } from "@/lib/utils";
import { resolvePeriod, type TrafegoSearch } from "@/lib/trafego";

type Ctx = Awaited<ReturnType<typeof getContext>>;
const nf = new Intl.NumberFormat("pt-BR");

export async function WhatsappTab({ ctx, sp }: { ctx: Ctx; sp: TrafegoSearch }) {
  const { since, until } = resolvePeriod(sp);
  const campFilter = sp.campanha ? sql`and ai.meta_campaign_id = ${sp.campanha}` : sql``;
  const contaFilter = sp.conta ? sql`and a.connection_id = ${sp.conta}` : sql``;
  const r = await db.execute(sql`
    select a.meta_ad_id, a.name, a.channel,
      coalesce(sum(ai.messages_started),0)::bigint as conversas,
      coalesce(sum(ai.spend_cents),0)::bigint as spend,
      (select count(*) from contacts ct where ct.company_id = a.company_id and ct.deleted_at is null and ct.meta_ad_id = a.meta_ad_id and ct.whatsapp is not null) as crm_leads
    from meta_ads a
    join meta_ad_insights_daily ai on ai.company_id = a.company_id and ai.meta_ad_id = a.meta_ad_id and ai.date >= ${since} and ai.date <= ${until}
    where a.company_id = ${ctx.companyId} ${campFilter} ${contaFilter}
    group by a.meta_ad_id, a.name, a.channel
    having coalesce(sum(ai.messages_started),0) > 0
    order by conversas desc
  `);
  const rows = (r.rows as Record<string, unknown>[]).map((x) => {
    const conversas = Number(x.conversas);
    const spend = Number(x.spend);
    return {
      id: String(x.meta_ad_id),
      name: String(x.name),
      channel: String(x.channel ?? ""),
      conversas,
      spend,
      custo: conversas ? Math.round(spend / conversas) : 0,
      crmLeads: Number(x.crm_leads),
    };
  });
  if (!rows.length) return <Empty>Nenhum anúncio com conversas de WhatsApp no período.</Empty>;

  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Anúncio</th>
            <th>Canal</th>
            <th className="text-right">Conversas WhatsApp</th>
            <th className="text-right">Investido</th>
            <th className="text-right">Custo/conversa</th>
            <th className="text-right">Leads CRM</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-medium">{r.name}</td>
              <td className="text-xs text-muted">{r.channel}</td>
              <td className="text-right">{nf.format(r.conversas)}</td>
              <td className="text-right">{money(r.spend)}</td>
              <td className="text-right">{r.custo ? money(r.custo) : "—"}</td>
              <td className="text-right font-semibold">{r.crmLeads}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
