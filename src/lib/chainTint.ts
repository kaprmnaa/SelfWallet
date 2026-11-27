/**
 * Warna khas jaringan untuk cahaya lembut di kartu jaringan dan cincin ikon koin.
 * Hanya aksen: palet utama aplikasi tetap dasar. Simbol tak dikenal -> warna deterministik dari simbolnya.
 */
const TINT: Record<string, string> = {
  ETH: "#627EEA",
  BNB: "#F3BA2F",
  BTC: "#F7931A",
  SOL: "#9945FF",
  ZEC: "#F4B728",
  POL: "#8247E5",
  MATIC: "#8247E5",
  AVAX: "#E84142",
  OP: "#FF4B5C",
  ARB: "#28A0F0",
  BASE: "#3C8AFF",
  FTM: "#1969FF",
  CELO: "#FCFF52",
  XDAI: "#04795B",
  GNO: "#04795B",
};

export function chainTint(symbol: string): string {
  const s = symbol.toUpperCase().replace(/^T(?=BNB$|BTC$)/, "");
  const hit = TINT[s];
  if (hit) return hit;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 62%)`;
}
