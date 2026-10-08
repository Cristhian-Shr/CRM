"use client";

import { Lock, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form } from "@/components/form";
import { cn, fmtDateTime } from "@/lib/utils";
import { sendMessage } from "@/server/actions/conversations";

export type ChatMessage = {
  id: string;
  direction: string;
  senderType: string;
  type: string;
  body: string | null;
  status: string | null;
  sentAt: string;
  senderName: string | null;
};

export function Chat({ contactId, messages, connected }: { contactId: string; messages: ChatMessage[]; connected: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const [internal, setInternal] = useState(!connected);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [messages.length]);

  return (
    <div className="flex h-[60vh] flex-col rounded-xl border border-line bg-[#f4efe9]">
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.length === 0 && <p className="text-center text-sm text-muted">Nenhuma mensagem ainda.</p>}
        {messages.map((m) => {
          const note = m.type === "note";
          const out = m.direction === "outbound";
          return (
            <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                  note ? "border border-amber-200 bg-amber-50" : out ? "bg-[#dcf8c6]" : "bg-surface",
                )}
              >
                {note && (
                  <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
                    <Lock className="size-3" /> Nota interna
                  </div>
                )}
                {m.senderType === "ai" && <div className="mb-1 text-[11px] font-medium text-brand-600">Atendente automático</div>}
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className="mt-1 text-right text-[10px] text-muted">
                  {out && m.senderName ? `${m.senderName} · ` : ""}
                  {fmtDateTime(m.sentAt)}
                  {m.status === "read" ? " ✓✓" : m.status === "delivered" ? " ✓✓" : m.status === "sent" ? " ✓" : m.status === "failed" ? " ⚠" : ""}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <Form action={sendMessage.bind(null, contactId)} className="space-y-2 border-t border-line bg-surface p-3">
        <input type="hidden" name="internal" value={internal ? "1" : "0"} />
        <div className="flex gap-2">
          <textarea
            name="body"
            rows={1}
            required
            placeholder={internal ? "Escreva uma nota interna (só a equipe vê)" : "Escreva uma mensagem de WhatsApp"}
            className="input flex-1 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button className="btn-primary px-3" aria-label="Enviar">
            <Send className="size-4" />
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} disabled={!connected} className="accent-brand-500" />
          Nota interna {connected ? "" : "(WhatsApp ainda não conectado)"}
        </label>
      </Form>
    </div>
  );
}
