import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Confere o cabeçalho X-Hub-Signature-256 enviado pela Meta. */
export function verifySignature(rawBody: string, header: string | null) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production"; // em dev aceita sem segredo
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendText(phoneNumberId: string, token: string, to: string, body: string) {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "text",
      text: { body },
    }),
  });
  const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `WhatsApp respondeu ${res.status}`);
  return json.messages?.[0]?.id ?? null;
}

// Tipos (parciais) do webhook da Cloud API
export type WaWebhook = {
  entry?: {
    changes?: {
      field: string;
      value: {
        metadata?: { phone_number_id: string; display_phone_number: string };
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: WaMessage[];
        statuses?: { id: string; status: string }[];
      };
    }[];
  }[];
};

export type WaMessage = {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  audio?: { id: string };
  video?: { id: string; caption?: string };
  document?: { id: string; filename?: string };
  button?: { text: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  referral?: { source_id?: string; source_type?: string; headline?: string; ctwa_clid?: string };
};

export function messageText(m: WaMessage) {
  return (
    m.text?.body ??
    m.image?.caption ??
    m.video?.caption ??
    m.document?.filename ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    (m.type === "audio" ? "🎤 Áudio" : m.type === "image" ? "📷 Imagem" : `[${m.type}]`)
  );
}
