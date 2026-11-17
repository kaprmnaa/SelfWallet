import React from "react";
import ReactDOM from "react-dom/client";
import { LazyMotion, MotionConfig } from "framer-motion";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import App from "./App";
import { SettingsProvider } from "./context/SettingsContext";
import { WalletProvider } from "./context/WalletContext";
import "./index.css";

// Tautan magic link Supabase mengembalikan token di URL: proses lebih awal agar sesi tersimpan walau dompet terkunci.
if (/[#&?](access_token|refresh_token|error_description)=/.test(window.location.hash + window.location.search)) {
  void import("./goals/sync").then((m) => m.consumeAuthRedirect()).catch(() => {});
}

// Fitur animasi framer-motion dimuat setelah render pertama (keluar dari bundle utama).
const loadFeatures = () => import("./lib/motionFeatures").then((m) => m.default);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* reducedMotion="user": hormati pengaturan "kurangi gerakan" di perangkat */}
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        <SettingsProvider>
          <WalletProvider>
            <App />
          </WalletProvider>
        </SettingsProvider>
      </LazyMotion>
    </MotionConfig>
  </React.StrictMode>,
);
