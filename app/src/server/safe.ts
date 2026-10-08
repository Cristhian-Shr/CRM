import { ZodError } from "zod";

export type ActionResult = { error?: string; ok?: boolean; id?: string } | void;

/** Executa uma Server Action devolvendo a mensagem de erro para o formulário. */
export async function safe(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw e;
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Dados inválidos." };
    console.error(e);
    return { error: e instanceof Error ? e.message : "Erro inesperado." };
  }
}
