import type { NextRequest } from "next/server";

/** A Vercel envia "Authorization: Bearer <CRON_SECRET>" nas rotinas agendadas. */
export function cronAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
