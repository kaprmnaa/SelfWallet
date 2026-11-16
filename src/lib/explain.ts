/** Pesan galat jaringan yang bisa ditindaklanjuti (bukan sekadar "gagal"). */
export function explainError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/\b403\b/.test(m) && !/browser/i.test(m)) return `${m} (penyedia menolak lalu lintas dari browser; pakai endpoint kustom)`;
  if (/\b429\b/.test(m) && !/laju/i.test(m)) return `${m} (dibatasi laju; tunggu sebentar atau pakai endpoint kustom)`;
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Tidak bisa dihubungi (jaringan, CORS, atau diblokir)";
  return m;
}

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
