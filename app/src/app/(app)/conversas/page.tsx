import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { Chat, type ChatMessage } from "@/components/client/chat";
import { Avatar, Empty, PageHeader } from "@/components/ui";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { contactScope } from "@/lib/db/tenant";
import { cn, fmtDateTime, fmtPhone } from "@/lib/utils";

export const metadata = { title: "Conversas" };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const ctx = await getContext();
  const { c } = await searchParams;

  const list = await db
    .select({
      id: schema.conversations.id,
      contactId: schema.contacts.id,
      name: schema.contacts.name,
      phone: schema.contacts.phone,
      lastMessageAt: schema.conversations.lastMessageAt,
      unread: schema.conversations.unreadCount,
    })
    .from(schema.conversations)
    .innerJoin(schema.contacts, eq(schema.contacts.id, schema.conversations.contactId))
    .where(and(eq(schema.conversations.companyId, ctx.companyId), contactScope(ctx), isNotNull(schema.conversations.lastMessageAt)))
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(200);

  const current = list.find((x) => x.id === c) ?? list[0];
  if (current?.unread) {
    await db.update(schema.conversations).set({ unreadCount: 0 }).where(eq(schema.conversations.id, current.id));
  }

  const [msgs, wa] = current
    ? await Promise.all([
        db
          .select({
            id: schema.messages.id,
            direction: schema.messages.direction,
            senderType: schema.messages.senderType,
            type: schema.messages.type,
            body: schema.messages.body,
            status: schema.messages.status,
            sentAt: schema.messages.sentAt,
            senderName: schema.users.name,
          })
          .from(schema.messages)
          .leftJoin(schema.users, eq(schema.users.id, schema.messages.senderUserId))
          .where(eq(schema.messages.conversationId, current.id))
          .orderBy(asc(schema.messages.sentAt))
          .limit(500),
        db.query.whatsappAccounts.findFirst({
          where: and(eq(schema.whatsappAccounts.companyId, ctx.companyId), eq(schema.whatsappAccounts.status, "connected")),
        }),
      ])
    : [[], undefined];

  return (
    <>
      <PageHeader title="Conversas" subtitle="Mensagens do WhatsApp de todos os leads e clientes" />
      {list.length === 0 ? (
        <Empty>
          Nenhuma conversa ainda. Quando o WhatsApp estiver conectado em{" "}
          <Link href="/configuracoes/integracoes" className="text-brand-600 underline">
            Configurações → Integrações
          </Link>
          , as mensagens recebidas aparecem aqui e criam o lead automaticamente.
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="card max-h-[70vh] divide-y divide-line overflow-y-auto">
            {list.map((x) => (
              <Link key={x.id} href={`?c=${x.id}`} className={cn("flex items-center gap-3 p-3 hover:bg-brand-50", current?.id === x.id && "bg-brand-50")}>
                <Avatar name={x.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{x.name}</div>
                  <div className="text-xs text-muted">{fmtPhone(x.phone)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-muted">{fmtDateTime(x.lastMessageAt)}</div>
                  {x.unread > 0 && x.id !== current?.id && <span className="badge bg-green-600 text-white">{x.unread}</span>}
                </div>
              </Link>
            ))}
          </div>
          {current && (
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-semibold">{current.name}</div>
                <Link href={`/clientes/${current.contactId}`} className="btn-secondary py-1.5 text-xs">
                  Abrir ficha
                </Link>
              </div>
              <Chat
                contactId={current.contactId}
                connected={!!wa}
                messages={msgs.map<ChatMessage>((m) => ({ ...m, sentAt: m.sentAt.toISOString() }))}
              />
            </div>
          )}
        </div>
      )}
    </>
  );
}
