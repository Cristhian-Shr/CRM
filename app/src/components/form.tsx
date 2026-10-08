"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/server/safe";
import { cn } from "@/lib/utils";
import { useModal } from "./modal";

export function Form({
  action,
  children,
  className,
  resetOnSuccess = true,
  onSuccess,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const modal = useModal();
  const [state, formAction] = useActionState(async (_prev: ActionResult, fd: FormData) => {
    const r = await action(fd);
    if (!r?.error) {
      if (resetOnSuccess) ref.current?.reset();
      modal?.close();
      onSuccess?.();
    }
    return r;
  }, undefined);

  return (
    <form ref={ref} action={formAction} className={cn("space-y-4", className)}>
      {children}
      {state?.error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

export function Submit({ children, className = "btn-primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Salvando..." : children}
    </button>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
