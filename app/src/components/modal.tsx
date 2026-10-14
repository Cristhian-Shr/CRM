"use client";

import { X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const ModalCtx = createContext<{ close: () => void } | null>(null);
export const useModal = () => useContext(ModalCtx);

export function Modal({
  trigger,
  title,
  children,
  wide,
  xl,
  triggerClassName = "btn-primary",
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: {
  trigger?: ReactNode;
  title: string;
  children: ReactNode;
  wide?: boolean;
  xl?: boolean;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (o: boolean) => {
    setInnerOpen(o);
    onOpenChange?.(o);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {trigger && (
        <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
          {trigger}
        </button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 pt-[8vh]" onMouseDown={() => setOpen(false)}>
          <div
            className={cn("card w-full p-6 shadow-xl", xl ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-lg")}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{title}</h3>
              <button type="button" className="btn-ghost p-1.5" onClick={() => setOpen(false)} aria-label="Fechar">
                <X className="size-4" />
              </button>
            </div>
            <ModalCtx.Provider value={{ close: () => setOpen(false) }}>{children}</ModalCtx.Provider>
          </div>
        </div>
      )}
    </>
  );
}
