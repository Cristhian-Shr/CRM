"use client";

import { Printer } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/** Card de relatório com ícone no canto para imprimir somente esta seção. */
export function ReportSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  function printOne() {
    const el = ref.current;
    if (!el) return;
    el.classList.add("print-active");
    document.body.classList.add("printing-single");
    const cleanup = () => {
      el.classList.remove("print-active");
      document.body.classList.remove("printing-single");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  return (
    <section ref={ref} data-report-section className={cn("card break-inside-avoid p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={printOne}
          title="Imprimir esta seção"
          aria-label={`Imprimir ${title}`}
          className="btn-ghost p-1.5 print:hidden"
        >
          <Printer className="size-4" />
        </button>
      </div>
      {children}
    </section>
  );
}
