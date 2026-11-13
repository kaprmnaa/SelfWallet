export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function trimAmount(v: string, max = 6): string {
  const [i, f = ""] = v.split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : i;
}

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  return `${Math.floor(h / 24)} hari lalu`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string, mime = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errMsg(e: unknown): string {
  const short = (e as { shortMessage?: string })?.shortMessage;
  if (short) return short;
  if (e instanceof Error) return e.message;
  return "Terjadi kesalahan tak terduga.";
}
