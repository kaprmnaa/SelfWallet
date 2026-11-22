/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Aksen utama: Electric Blue. `hi` = Sky Blue (hover).
        accent: { DEFAULT: "#398BFF", hi: "#65B5FF" },

        // Palet crypto / blockchain.
        brand: { electric: "#398BFF", royal: "#2457D6", navy: "#0B1730", neon: "#27D8FF", ice: "#B8E7FF", sky: "#65B5FF" },
        chart: { blue: "#398BFF", cyan: "#27D8FF", purple: "#9270FF", green: "#22C98A", red: "#FF5470" },
        status: { success: "#22C98A", error: "#FF5470", warning: "#FFC857", info: "#398BFF" },

        // Skala netral dipetakan ke palet (semua class zinc-* yang sudah ada ikut berganti tema):
        //  950 Midnight (background) · 900 Dark Surface (kartu/modal) · 850 Elevated Surface
        //  800 Subtle Border · 700 Primary Border · 600 Disabled · 500 Muted · 400 Secondary · 50 Primary Text
        zinc: {
          50: "#EAF3FF",
          100: "#E3EEFC",
          200: "#D3E1F3",
          300: "#C6D4E7",
          400: "#B8C7DC",
          500: "#8FA4C0",
          600: "#52647D",
          700: "#263750",
          800: "#1B2B43",
          850: "#192944",
          900: "#111D33",
          950: "#070D1A",
        },

        // Warna status menggantikan rose / amber / emerald bawaan Tailwind.
        rose: { 300: "#FF8FA2", 400: "#FF5470" },
        amber: { 100: "#FFF1CC", 200: "#FFE29A", 300: "#FFD375", 400: "#FFC857" },
        emerald: { 300: "#5EE0AE", 400: "#22C98A" },
      },
      fontFamily: {
        sans: ['"Geist Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"Geist Mono Variable"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        shimmer: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: { shimmer: "shimmer 1.6s cubic-bezier(0.4,0,0.2,1) infinite" },
    },
  },
  plugins: [],
};
