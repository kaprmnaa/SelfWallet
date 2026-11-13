import { memo } from "react";

function hue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** Avatar wallet: kotak membulat dengan huruf akhir nama ("Main A" menjadi "A"), warna tetap per wallet. */
function WalletAvatarBase({ seed, label, size = 32 }: { seed: string; label: string; size?: number }) {
  const h = hue(seed);
  const letter = label.trim().split(/\s+/).pop()?.[0]?.toUpperCase() ?? "?";
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-xl font-mono font-medium"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${h} 22% 20%)`,
        color: `hsl(${h} 32% 82%)`,
      }}
    >
      {letter}
    </span>
  );
}

export default memo(WalletAvatarBase);
