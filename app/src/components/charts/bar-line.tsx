type Point = { label: string; bar: number; line: number };

/** Gráfico combo sem dependência: barras (esq.) + linha (dir.). Valores já formatados fora. */
export function BarLineChart({ data, barLabel, lineLabel, height = 240 }: { data: Point[]; barLabel: string; lineLabel: string; height?: number }) {
  if (!data.length) return <p className="p-6 text-sm text-muted">Sem dados no período.</p>;
  const w = Math.max(data.length * 36, 320);
  const pad = { t: 10, r: 8, b: 24, l: 8 };
  const innerH = height - pad.t - pad.b;
  const maxBar = Math.max(1, ...data.map((d) => d.bar));
  const maxLine = Math.max(1, ...data.map((d) => d.line));
  const bw = (w - pad.l - pad.r) / data.length;
  const x = (i: number) => pad.l + i * bw + bw / 2;
  const yBar = (v: number) => pad.t + innerH - (v / maxBar) * innerH;
  const yLine = (v: number) => pad.t + innerH - (v / maxLine) * innerH;
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${yLine(d.line)}`).join(" ");

  return (
    <div className="overflow-x-auto">
      <svg width={w} height={height} role="img" aria-label={`${barLabel} x ${lineLabel}`} className="min-w-full">
        {data.map((d, i) => (
          <rect key={i} x={x(i) - bw * 0.3} y={yBar(d.bar)} width={bw * 0.6} height={pad.t + innerH - yBar(d.bar)} rx={2} className="fill-blue-600/80" />
        ))}
        <path d={path} fill="none" className="stroke-blue-400" strokeWidth={2} />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={yLine(d.line)} r={2.5} className="fill-blue-400" />
        ))}
        {data.map((d, i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[9px]">
            {d.label}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-blue-600/80" /> {barLabel}</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-blue-400" /> {lineLabel}</span>
      </div>
    </div>
  );
}
