"use client";

import { Eye, EyeOff } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { money } from "@/lib/utils";

const KEY = "master:hideValues";
const Ctx = createContext<{ hidden: boolean; toggle: () => void }>({ hidden: false, toggle: () => {} });

export function ValuesProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(localStorage.getItem(KEY) === "1");
  }, []);

  const toggle = () =>
    setHidden((h) => {
      const next = !h;
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {}
      return next;
    });

  return <Ctx.Provider value={{ hidden, toggle }}>{children}</Ctx.Provider>;
}

export function useValuesHidden() {
  return useContext(Ctx);
}

/** Valor monetário que respeita o toggle global de ocultar valores. */
export function Money({ value, mask = "R$ ••••" }: { value: number | null | undefined; mask?: string }) {
  const { hidden } = useContext(Ctx);
  return (
    <span className="tabular-nums" suppressHydrationWarning>
      {hidden ? mask : money(value)}
    </span>
  );
}

/** Botão de olho para ocultar/mostrar os valores do painel. */
export function ValuesToggle() {
  const { hidden, toggle } = useContext(Ctx);
  const label = hidden ? "Mostrar valores" : "Ocultar valores";
  return (
    <button type="button" onClick={toggle} className="btn-ghost p-2" title={label} aria-label={label} aria-pressed={hidden}>
      {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );
}
