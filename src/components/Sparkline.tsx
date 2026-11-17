/** Grafik perjalanan sederhana (SVG murni, tanpa pustaka): nilai dari waktu ke waktu + garis target. */
export default function Sparkline({
  points,
  target,
  start,
}: {
  points: { ts: number; value: number }[];
  target: number;
  start: number;
}) {
  if (points.length < 2) {
    return <p className="text-xs text-zinc-600">Grafik muncul setelah ada beberapa pembaruan data.</p>;
  }
  const W = 300;
  const H = 72;
  const P = 4;
  const ts = points.map((p) => p.ts);
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const vals = points.map((p) => p.value);
  const vmin = Math.min(start, ...vals);
  const vmax = Math.max(target, ...vals);
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - vmin) / (vmax - vmin || 1)) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.ts).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[72px] w-full" role="img" aria-label="Grafik perjalanan menuju target">
      <line x1={P} x2={W - P} y1={y(target)} y2={y(target)} className="stroke-zinc-600" strokeDasharray="4 4" strokeWidth="1" />
      <path d={d} fill="none" className="stroke-[#5fb396]" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.ts)} cy={y(last.value)} r="3" className="fill-[#5fb396]" />
    </svg>
  );
}
