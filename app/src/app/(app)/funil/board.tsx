"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertCircle, Clock, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { Avatar } from "@/components/ui";
import { cn, fmtDateTime, fmtPhone } from "@/lib/utils";
import { moveDeal } from "@/server/actions/leads";

export type BoardDeal = {
  id: string;
  title: string;
  valueCents: number;
  stageId: string;
  position: number;
  stageEnteredAt: string;
  contactId: string;
  contactName: string;
  phone: string | null;
  ownerName: string | null;
  ownerColor: string | null;
  nextTaskAt: string | null;
};
type Stage = { id: string; name: string; color: string; kind: string };

export function Board({ stages, deals: initial, lossReasons }: { stages: Stage[]; deals: BoardDeal[]; lossReasons: { id: string; name: string }[] }) {
  const router = useRouter();
  const [deals, setDeals] = useState(initial);
  const [pendingLoss, setPendingLoss] = useState<{ dealId: string; stageId: string; index: number } | null>(null);
  const [wonContact, setWonContact] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => setDeals(initial), [initial]);

  function apply(dealId: string, stageId: string, index: number, extra?: { lossReasonId: string; lossNote?: string }) {
    setDeals((prev) => {
      const moving = prev.find((d) => d.id === dealId)!;
      const rest = prev.filter((d) => d.id !== dealId);
      const col = rest.filter((d) => d.stageId === stageId).sort((a, b) => a.position - b.position);
      col.splice(index, 0, { ...moving, stageId, stageEnteredAt: moving.stageId === stageId ? moving.stageEnteredAt : new Date().toISOString() });
      const positioned = col.map((d, i) => ({ ...d, position: i }));
      return [...rest.filter((d) => d.stageId !== stageId), ...positioned];
    });
    start(async () => {
      const r = await moveDeal({ dealId, stageId, index, ...extra });
      if (r?.error) setError(r.error);
      else if (r?.id) setWonContact(r.id);
      router.refresh();
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const dealId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const deal = deals.find((d) => d.id === dealId)!;
    let stageId: string;
    let index: number;
    if (overId.startsWith("col:")) {
      stageId = overId.slice(4);
      index = deals.filter((d) => d.stageId === stageId && d.id !== dealId).length;
    } else {
      const over = deals.find((d) => d.id === overId.slice(5))!;
      stageId = over.stageId;
      index = deals
        .filter((d) => d.stageId === stageId && d.id !== dealId)
        .sort((a, b) => a.position - b.position)
        .findIndex((d) => d.id === over.id);
    }
    const stage = stages.find((s) => s.id === stageId)!;
    if (stage.kind === "lost" && deal.stageId !== stageId) {
      setPendingLoss({ dealId, stageId, index });
      return;
    }
    apply(dealId, stageId, index);
  }

  return (
    <>
      {error && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {wonContact && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-green-50 p-3 text-sm text-green-800">
          Venda fechada! Monte a comanda com o programa ou procedimentos contratados.
          <div className="flex gap-2">
            <Link href={`/clientes/${wonContact}?comanda=1`} className="btn-primary py-1.5">
              Montar comanda
            </Link>
            <button className="btn-ghost py-1.5" onClick={() => setWonContact(null)}>
              Depois
            </button>
          </div>
        </div>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
          {stages.map((s) => {
            const col = deals.filter((d) => d.stageId === s.id).sort((a, b) => a.position - b.position);
            return <Column key={s.id} stage={s} deals={col} />;
          })}
        </div>
      </DndContext>

      <Modal title="Motivo da perda" open={!!pendingLoss} onOpenChange={(o) => !o && setPendingLoss(null)}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (!pendingLoss) return;
            apply(pendingLoss.dealId, pendingLoss.stageId, pendingLoss.index, {
              lossReasonId: String(fd.get("reason")),
              lossNote: String(fd.get("note") ?? "") || undefined,
            });
            setPendingLoss(null);
          }}
        >
          <select name="reason" required className="input">
            {lossReasons.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <textarea name="note" rows={2} className="input" placeholder="Detalhes (opcional)" />
          <button className="btn-danger w-full">Marcar como perdido</button>
        </form>
      </Modal>
    </>
  );
}

function Column({ stage, deals }: { stage: Stage; deals: BoardDeal[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${stage.id}` });
  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="mb-2 rounded-xl border-t-4 bg-surface px-3 py-2.5 shadow-sm" style={{ borderTopColor: stage.color }}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">{stage.name}</span>
          <span className="badge bg-brand-50 text-brand-700">{deals.length}</span>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn("min-h-[60vh] flex-1 space-y-2 rounded-xl p-1 transition", isOver && "bg-brand-50")}
      >
        {deals.map((d) => (
          <Card key={d.id} deal={d} closed={stage.kind !== "open"} />
        ))}
      </div>
    </div>
  );
}

function Card({ deal, closed }: { deal: BoardDeal; closed: boolean }) {
  const drag = useDraggable({ id: deal.id });
  const drop = useDroppable({ id: `card:${deal.id}` });
  const days = Math.floor((Date.now() - new Date(deal.stageEnteredAt).getTime()) / 86_400_000);
  const overdue = deal.nextTaskAt && new Date(deal.nextTaskAt) < new Date();
  return (
    <div ref={drop.setNodeRef}>
      <div
        ref={drag.setNodeRef}
        {...drag.listeners}
        {...drag.attributes}
        style={{ transform: CSS.Translate.toString(drag.transform) }}
        className={cn(
          "card cursor-grab space-y-2 p-3 text-sm active:cursor-grabbing",
          drag.isDragging && "z-10 rotate-1 shadow-lg",
          drop.isOver && !drag.isDragging && "ring-2 ring-brand-200",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <Link href={`/clientes/${deal.contactId}`} className="font-semibold hover:text-brand-600" onPointerDown={(e) => e.stopPropagation()}>
            {deal.contactName}
          </Link>
          {deal.ownerName && <Avatar name={deal.ownerName} color={deal.ownerColor} size="sm" />}
        </div>
        <div className="text-muted">{deal.title}</div>
        {deal.phone && (
          <div className="flex items-center gap-1 text-xs text-muted">
            <Phone className="size-3" /> {fmtPhone(deal.phone)}
          </div>
        )}
        <div className="flex items-center justify-end">
          <span className={cn("flex items-center gap-1 text-xs", days >= 3 && !closed ? "text-red-600" : "text-muted")}>
            <Clock className="size-3" /> {days}d
          </span>
        </div>
        {closed ? null : !deal.nextTaskAt ? (
          <div className="flex items-center gap-1 text-xs text-amber-700">
            <AlertCircle className="size-3" /> Sem follow-up
          </div>
        ) : (
          <div className={cn("text-xs", overdue ? "font-medium text-red-600" : "text-muted")}>
            {overdue ? "Follow-up atrasado · " : "Follow-up · "}
            {fmtDateTime(deal.nextTaskAt)}
          </div>
        )}
      </div>
    </div>
  );
}
