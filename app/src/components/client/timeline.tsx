import {
  ArrowRightLeft,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Phone,
  ShoppingBag,
  StickyNote,
  UserPlus,
  UserRoundCog,
  type LucideIcon,
} from "lucide-react";
import { fmtDateTime } from "@/lib/utils";

export type TimelineItem = { id: string; type: string; payload: Record<string, unknown>; createdAt: Date; actor: string | null };

const MAP: Record<string, { icon: LucideIcon; text: (p: Record<string, unknown>) => string }> = {
  lead_created: { icon: UserPlus, text: () => "Lead cadastrado" },
  deal_created: { icon: ClipboardList, text: (p) => `Nova oportunidade: ${p.title}` },
  stage_changed: { icon: ArrowRightLeft, text: (p) => `Etapa: ${p.from ?? "—"} → ${p.to}` },
  owner_changed: { icon: UserRoundCog, text: () => "Responsável alterado" },
  note: { icon: StickyNote, text: (p) => String(p.text ?? "") },
  call: { icon: Phone, text: (p) => `Ligação: ${p.text ?? ""}` },
  message_in: { icon: MessageCircle, text: (p) => `Mensagem recebida: ${p.text ?? ""}` },
  message_out: { icon: MessageCircle, text: (p) => `Mensagem enviada: ${p.text ?? ""}` },
  appointment_created: { icon: CalendarPlus, text: (p) => `Agendado ${p.procedure} para ${p.when}` },
  appointment_status: { icon: CalendarPlus, text: (p) => `Atendimento de ${p.when}: ${p.status}` },
  order_created: {
    icon: ShoppingBag,
    text: (p) => `Comanda ${p.status === "confirmed" ? "confirmada" : "criada"}: ${p.items ? `${p.items} · ` : ""}${p.total}`,
  },
  task_created: { icon: ClipboardList, text: (p) => `Tarefa criada: ${p.title}` },
  task_done: { icon: CheckCircle2, text: (p) => `Tarefa concluída: ${p.title}` },
};

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (!items.length) return <p className="text-sm text-muted">Nenhuma interação registrada.</p>;
  return (
    <ol className="relative space-y-4 border-l border-line pl-6">
      {items.map((a) => {
        const m = MAP[a.type] ?? { icon: StickyNote, text: () => a.type };
        const Icon = m.icon;
        return (
          <li key={a.id} className="relative">
            <span className="absolute top-0.5 -left-[34px] flex size-6 items-center justify-center rounded-full border border-line bg-surface">
              <Icon className="size-3.5 text-brand-500" />
            </span>
            <div className="text-sm whitespace-pre-wrap">{m.text(a.payload)}</div>
            <div className="text-xs text-muted">
              {fmtDateTime(a.createdAt)}
              {a.actor ? ` · ${a.actor}` : ""}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
