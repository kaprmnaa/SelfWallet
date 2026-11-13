import { Suspense, lazy, memo } from "react";

// Pustaka ikon bisa besar: diunduh di luar bundle utama, ikon lokal tampil dulu.
const CryptoIcon = lazy(() => import("@cryptofonts/react").then((m) => ({ default: m.CryptoIcon })));

/**
 * Ikon utama: pustaka Cryptofonts (@cryptofonts/react) lewat <CryptoIcon name="btc" />.
 * Cadangan (simbol tidak dikenal / gagal dimuat): ikon SVG sederhana buatan sendiri
 * (BUKAN logo resmi) atau avatar huruf dengan warna deterministik dari simbolnya.
 */
function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function LocalCoinIcon({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const key = symbol.toUpperCase() === "TBNB" ? "BNB" : symbol.toUpperCase();
  const common = { width: size, height: size, viewBox: "0 0 32 32", role: "img", "aria-label": symbol } as const;

  switch (key) {
    case "ETH":
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="16" fill="#2a2e3f" />
          <polygon points="16,5 23.5,16.2 16,13 8.5,16.2" fill="#c9cde0" />
          <polygon points="16,27 23.5,18.2 16,21.6 8.5,18.2" fill="#9aa0bb" />
        </svg>
      );
    case "BNB":
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="16" fill="#3a3220" />
          <g fill="#d6b24a">
            <polygon points="16,12.2 19.8,16 16,19.8 12.2,16" />
            <polygon points="16,5.5 19,8.5 16,11.5 13,8.5" />
            <polygon points="16,20.5 19,23.5 16,26.5 13,23.5" />
            <polygon points="5.5,16 8.5,13 11.5,16 8.5,19" />
            <polygon points="20.5,16 23.5,13 26.5,16 23.5,19" />
          </g>
        </svg>
      );
    case "POL":
    case "MATIC":
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="16" fill="#3b3660" />
          <polygon points="16,7 23.8,11.5 23.8,20.5 16,25 8.2,20.5 8.2,11.5" fill="none" stroke="#c4bfe6" strokeWidth="2.2" strokeLinejoin="round" />
        </svg>
      );
    case "USDT":
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="16" fill="#1f4d43" />
          <path d="M9 10.5h14v3h-5.5V23h-3v-9.5H9z" fill="#b9e3d5" />
        </svg>
      );
    case "USDC":
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="16" fill="#1f3f6e" />
          <circle cx="16" cy="16" r="8.2" fill="none" stroke="#b6cdf0" strokeWidth="2" />
          <text x="16" y="20.4" textAnchor="middle" fontSize="12" fontWeight="700" fill="#b6cdf0" fontFamily="ui-monospace, monospace">
            $
          </text>
        </svg>
      );
    default: {
      const h = hue(key);
      return (
        <svg {...common}>
          <circle cx="16" cy="16" r="16" fill={`hsl(${h} 22% 22%)`} />
          <text x="16" y="20.5" textAnchor="middle" fontSize={key.length > 2 ? 10 : 12} fontWeight="600" fill={`hsl(${h} 30% 80%)`} fontFamily="ui-sans-serif, system-ui, sans-serif">
            {key.slice(0, 3)}
          </text>
        </svg>
      );
    }
  }
}

/** Simbol token berasal dari contract (tidak tepercaya): hanya huruf/angka pendek yang diteruskan. */
function iconName(symbol: string): string | null {
  const n = symbol.toUpperCase() === "TBNB" ? "bnb" : symbol.toLowerCase();
  return /^[a-z0-9]{1,12}$/.test(n) ? n : null;
}

function CoinIconBase({ symbol, size = 32 }: { symbol: string; size?: number }) {
  const name = iconName(symbol);
  const fallback = <LocalCoinIcon symbol={symbol} size={size} />;
  return (
    <span className="inline-flex shrink-0" style={{ width: size, height: size }} role="img" aria-label={symbol}>
      {name ? (
        <Suspense fallback={fallback}>
          <CryptoIcon name={name} size={size} fallback={fallback} />
        </Suspense>
      ) : (
        fallback
      )}
    </span>
  );
}

export default memo(CoinIconBase);
