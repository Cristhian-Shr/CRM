"use client";

import {
  BarChart3,
  Building2,
  CalendarDays,
  FileText,
  Kanban,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Receipt,
  Settings,
  Syringe,
  Target,
  UserCog,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn, initials } from "@/lib/utils";

type Item = { href: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean };

const ITEMS: Item[] = [
  { href: "/dashboard", label: "Visão Geral", icon: LayoutDashboard },
  { href: "/funil", label: "Funil de Vendas", icon: Kanban },
  { href: "/clientes", label: "Leads / Clientes", icon: Users },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/catalogo", label: "Procedimentos e Programas", icon: Syringe },
  { href: "/orcamentos", label: "Orçamentos", icon: FileText },
  { href: "/campanhas", label: "Campanhas Meta", icon: Megaphone, adminOnly: true },
  { href: "/financeiro", label: "Financeiro", icon: Receipt, adminOnly: true },
  { href: "/metas", label: "Metas", icon: Target, adminOnly: true },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, adminOnly: true },
  { href: "/configuracoes/equipe", label: "Equipe", icon: UserCog, adminOnly: true },
  { href: "/configuracoes", label: "Configurações", icon: Settings, adminOnly: true },
];

export function Sidebar({
  companyName,
  userName,
  roleLabel,
  isAdmin,
  isMaster,
  logout,
}: {
  companyName: string;
  userName: string;
  roleLabel: string;
  isAdmin: boolean;
  isMaster: boolean;
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);
  const isActive = (href: string) =>
    href === "/configuracoes"
      ? pathname === href || (pathname.startsWith("/configuracoes/") && !pathname.startsWith("/configuracoes/equipe"))
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <button className="btn-secondary fixed top-3 left-3 z-40 p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
        <Menu className="size-5" />
      </button>
      {open && <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-surface transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b border-line px-5">
          <div className="flex size-11 items-center justify-center rounded-xl bg-brand-500 font-display text-lg font-bold text-white">
            {initials(companyName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-lg leading-tight font-semibold">{companyName}</div>
            <div className="text-[11px] tracking-[0.12em] text-muted uppercase">CRM - EstéticaPRO</div>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-2.5 text-[15px] font-medium transition",
                isActive(href) ? "bg-brand-500 text-white shadow-sm" : "text-muted hover:bg-brand-50 hover:text-ink",
              )}
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          ))}
          {isMaster && (
            <Link
              href="/master"
              className="mt-4 flex items-center gap-3 rounded-xl border border-brand-200 px-4 py-2.5 text-[15px] font-medium text-brand-600 hover:bg-brand-50"
            >
              <Building2 className="size-[18px]" />
              Área master
            </Link>
          )}
        </nav>
        <div className="flex items-center gap-3 border-t border-line p-4">
          <span className="flex size-9 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials(userName)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{userName}</div>
            <div className="text-xs text-muted">{roleLabel}</div>
          </div>
          <form action={logout}>
            <button className="btn-ghost p-2" title="Sair" aria-label="Sair">
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
