"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export async function markNotificationsRead() {
  const ctx = await getContext();
  await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.companyId, ctx.companyId),
        eq(schema.notifications.userId, ctx.userId),
        isNull(schema.notifications.readAt),
      ),
    );
  revalidatePath("/", "layout");
}
