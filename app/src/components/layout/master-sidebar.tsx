"use client";

import { Building2, Home, LogOut, Menu, Receipt, ScrollText, TrendingUp, Users, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";

const ITEMS = [
  { href: "/master", label: "Início", icon: Home, exact: true },
  { href: "/master/empresas", label: "Empresas", icon: Building2 },
  { href: "/master/vendas", label: "Vendas", icon: TrendingUp },
  { href: "/master/comandas", label: "Comandas", icon: Receipt },
  { href: "/master/faturamento", label: "Faturamento", icon: Wallet },
  { href: "/master/usuarios", label: "Usuários", icon: Users },
  { href: "/master/auditoria", label: "Auditoria", icon: ScrollText },
];

export function MasterSidebar({ userName, logout }: { userName: string; logout: () => Promise<void> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

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
        <div className="flex items-center justify-between border-b border-line px-5 py-5">
          <div className="font-display text-xl font-semibold">
            EstéticaPRO <span className="text-brand-500">Master</span>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {ITEMS.map(({ href, label, icon: Icon, exact }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-3 rounded-xl px-4 py-2.5 text-[15px] font-medium transition-colors",
                isActive(href, exact) ? "bg-brand-500 text-white shadow-sm" : "text-muted hover:bg-brand-50 hover:text-ink",
              )}
            >
              <Icon className="size-[18px]" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-line p-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{userName}</div>
            <div className="text-xs text-muted">Admin master</div>
          </div>
          <ThemeToggle />
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
