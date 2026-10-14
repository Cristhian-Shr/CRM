import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export const TZ = "America/Sao_Paulo";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export function money(cents: number | null | undefined) {
  return brl.format((cents ?? 0) / 100);
}

/** "1.234,56" ou "1234.56" → centavos */
export function parseMoney(value: FormDataEntryValue | string | null | undefined): number {
  if (value == null) return 0;
  let s = String(value).replace(/[^\d,.-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function centsToInput(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toFixed(2).replace(".", ",");
}

export function fmtDate(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "short" }) {
  if (!d) return "";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...opts }).format(new Date(d));
}

/** Formata uma data pura "AAAA-MM-DD" como "DD/MM/AAAA" sem conversão de fuso (evita off-by-one). */
export function fmtISODate(ymd: string | null | undefined) {
  if (!ymd) return "";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : ymd;
}

export function fmtDateTime(d: Date | string | null | undefined) {
  return fmtDate(d, { dateStyle: "short", timeStyle: "short" });
}

export function fmtTime(d: Date | string | null | undefined) {
  return fmtDate(d, { hour: "2-digit", minute: "2-digit" });
}

/** Partes da data no fuso da clínica. */
export function zonedParts(d: Date, tz = TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** "2026-10-07" no fuso da clínica */
export function todayISO(tz = TZ, base = new Date()) {
  const p = zonedParts(base, tz);
  return `${p.y}-${p.m}-${p.d}`;
}

/** Converte "2026-10-07T14:30" (horário da clínica) em Date UTC. */
export function zonedToUtc(local: string, tz = TZ): Date {
  const [datePart, timePart = "00:00"] = local.split("T");
  const asUtc = new Date(`${datePart}T${timePart.slice(0, 5)}:00Z`);
  const p = zonedParts(asUtc, tz);
  const shown = Date.UTC(+p.y, +p.m - 1, +p.d, +p.h, +p.min);
  const offset = shown - asUtc.getTime();
  return new Date(asUtc.getTime() - offset);
}

/** Date → "2026-10-07T14:30" no fuso da clínica (para inputs datetime-local). */
export function toLocalInput(d: Date | string | null | undefined, tz = TZ) {
  if (!d) return "";
  const p = zonedParts(new Date(d), tz);
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}`;
}

/** Início e fim de um mês ("2026-10") no fuso da clínica. */
export function monthRange(month: string, tz = TZ) {
  const [y, m] = month.split("-").map(Number);
  const start = zonedToUtc(`${y}-${String(m).padStart(2, "0")}-01T00:00`, tz);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const end = zonedToUtc(`${ny}-${String(nm).padStart(2, "0")}-01T00:00`, tz);
  return { start, end };
}

export function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, 15)),
  );
}

/** Normaliza telefone brasileiro para o formato do WhatsApp: +5551999998888 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

export function fmtPhone(p: string | null | undefined) {
  if (!p) return "";
  const m = p.match(/^\+55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function ucfirst(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
