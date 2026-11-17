import { redirect } from "next/navigation";
import { ReportTable } from "@/app/(app)/relatorios/report-table";
import { getContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { normGroup, operationalReport } from "@/lib/reports";
import { fmtDateTime, fmtISODate, todayISO } from "@/lib/utils";
import { PrintTrigger } from "./print-trigger";

export const metadata = { title: "Relatório operacional" };

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const GROUP_LABEL = { day: "por dia", week: "por semana", month: "por mês" } as const;

export default async function RelatorioPdfPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; group?: string }>;
}) {
  const ctx = await getContext();
  if (!can(ctx, "reports.viewAll")) redirect("/dashboard");
  const sp = await searchParams;
  const today = todayISO();
  const from = isDate(sp.from) ? sp.from : `${today.slice(0, 7)}-01`;
  const to = isDate(sp.to) ? sp.to : today;
  const group = normGroup(sp.group);
  const report = await operationalReport(ctx.companyId, from, to, group);

  return (
    <main className="mx-auto max-w-3xl px-8 py-10 print:px-0 print:py-0">
      <PrintTrigger />
      <header className="mb-6 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold">Relatório operacional</h1>
        <p className="mt-1 text-sm text-muted">{ctx.companyName}</p>
        <p className="mt-2 text-sm">
          Período: <b>{fmtISODate(from)}</b> a <b>{fmtISODate(to)}</b> · agrupado {GROUP_LABEL[group]}
        </p>
      </header>

      <ReportTable data={report} group={group} />

      <footer className="mt-8 text-xs text-muted">Gerado em {fmtDateTime(new Date())}</footer>
    </main>
  );
}
