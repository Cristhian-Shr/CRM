import Link from "next/link";
import { Empty } from "@/components/ui";
import type { getContext } from "@/lib/auth";
import type { schema } from "@/lib/db";
import type { TrafegoSearch } from "@/lib/trafego";
import { fmtDateTime, money } from "@/lib/utils";

type Ctx = Awaited<ReturnType<typeof getContext>>;
type Conn = typeof schema.metaConnections.$inferSelect;

export async function VinculosTab({ ctx, sp, conns }: { ctx: Ctx; sp: TrafegoSearch; conns: Conn[] }) {
  void ctx;
  void sp;
  if (!conns.length) return <Empty>Nenhuma conta conectada.</Empty>;
  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Conta</th>
              <th>Página</th>
              <th>Moeda</th>
              <th>Tipo</th>
              <th className="text-right">Saldo</th>
              <th>Status</th>
              <th>Última sync</th>
            </tr>
          </thead>
          <tbody>
            {conns.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">
                  {c.accountName ?? c.adAccountId}
                  <div className="text-xs text-muted">{c.adAccountId}</div>
                </td>
                <td>{c.pageName ?? (c.pageId ? c.pageId : "—")}</td>
                <td>{c.currency}</td>
                <td>{c.fundingType === "prepaid" ? "Pré-pago" : c.fundingType === "postpaid" ? "Pós-pago" : "—"}</td>
                <td className="text-right">{c.balanceCents != null ? money(c.balanceCents) : "—"}</td>
                <td>{c.lastError ? <span className="text-red-600">erro</span> : <span className="text-green-600">{c.status}</span>}</td>
                <td className="text-xs text-muted">{c.lastSyncAt ? fmtDateTime(c.lastSyncAt) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        Para adicionar ou remover contas e definir a página, use{" "}
        <Link href="/configuracoes/integracoes" className="text-brand-600 underline">
          Configurações → Integrações
        </Link>
        .
      </p>
    </div>
  );
}
