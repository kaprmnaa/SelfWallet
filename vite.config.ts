import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Chunk stabil agar di-cache terpisah. framer-motion sengaja TIDAK dipisah manual:
        // fitur animasinya dimuat malas lewat LazyMotion (lihat src/main.tsx).
        manualChunks: {
          react: ["react", "react-dom"],
          ethers: ["ethers"],
        },
      },
    },
  },
});
