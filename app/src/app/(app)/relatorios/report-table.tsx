import { bucketLabel, type OperationalReport, type ReportGroup } from "@/lib/reports";
import { money } from "@/lib/utils";

const HEAD: Record<ReportGroup, string> = { day: "Dia", week: "Semana", month: "Mês" };

/** Ticket médio (faturamento ÷ vendas); "—" quando não houve vendas. */
function ticket(revenue: number, sales: number) {
  return sales > 0 ? money(Math.round(revenue / sales)) : "—";
}

/** Tabela do relatório operacional. Reutilizada na tela e na página de impressão. */
export function ReportTable({ data, group }: { data: OperationalReport; group: ReportGroup }) {
  const { rows, totals } = data;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>{HEAD[group]}</th>
          <th className="text-right">Leads</th>
          <th className="text-right">Agendamentos</th>
          <th className="text-right">Vendas</th>
          <th className="text-right">Faturamento</th>
          <th className="text-right">Ticket médio</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.bucket} className="border-b border-line">
            <td className="py-1.5">{bucketLabel(r.bucket, group)}</td>
            <td className="py-1.5 text-right">{r.leads}</td>
            <td className="py-1.5 text-right">{r.appts}</td>
            <td className="py-1.5 text-right">{r.sales}</td>
            <td className="py-1.5 text-right">{money(r.revenue)}</td>
            <td className="py-1.5 text-right">{ticket(r.revenue, r.sales)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="py-4 text-center text-muted">
              Sem dados no período.
            </td>
          </tr>
        )}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-line font-semibold">
          <td className="py-2">Total</td>
          <td className="py-2 text-right">{totals.leads}</td>
          <td className="py-2 text-right">{totals.appts}</td>
          <td className="py-2 text-right">{totals.sales}</td>
          <td className="py-2 text-right">{money(totals.revenue)}</td>
          <td className="py-2 text-right">{ticket(totals.revenue, totals.sales)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
