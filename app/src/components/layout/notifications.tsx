"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { markNotificationsRead } from "@/server/actions/notifications";
import { cn, fmtDateTime } from "@/lib/utils";

type N = { id: string; title: string; body: string | null; link: string | null; readAt: Date | null; createdAt: Date };

export function NotificationBell({ items }: { items: N[] }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="relative">
      <button
        className="btn-ghost relative p-2"
        aria-label="Notificações"
        onClick={() => {
          setOpen(!open);
          if (!open && unread) start(() => markNotificationsRead());
        }}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-brand-500 text-[10px] text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-30 mt-2 w-80 overflow-hidden p-0 shadow-lg">
          <div className="border-b border-line px-4 py-3 text-sm font-semibold">Notificações</div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && <p className="p-4 text-sm text-muted">Nada por aqui.</p>}
            {items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "#"}
                onClick={() => setOpen(false)}
                className={cn("block border-b border-line px-4 py-3 text-sm hover:bg-brand-50", !n.readAt && "bg-brand-50/50")}
              >
                <div className="font-medium">{n.title}</div>
                {n.body && <div className="text-muted">{n.body}</div>}
                <div className="mt-1 text-xs text-muted">{fmtDateTime(n.createdAt)}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
