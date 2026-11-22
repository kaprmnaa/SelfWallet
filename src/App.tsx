import { Suspense, lazy, useEffect, useState } from "react";
import { useWallet } from "./context/WalletContext";
import ErrorBoundary from "./components/ErrorBoundary";
import Onboarding from "./components/Onboarding";
import { IconProvider, Skeleton } from "./components/ui";

// Dashboard (dan semua panelnya) hanya diunduh setelah dompet dibuka.
const Dashboard = lazy(() => import("./components/Dashboard"));

function DashboardFallback() {
  // Pemuatan yang tak kunjung selesai (mis. server dev sedang mengoptimasi dependensi) jangan diam saja.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-16 sm:px-10">
      {slow && (
        <p className="text-sm text-zinc-400" role="status">
          Masih memuat. Jika tidak selesai, muat ulang halaman (Ctrl+Shift+R). Saat pengembangan: hentikan server, hapus <code>node_modules/.vite</code>,
          lalu jalankan <code>npm run dev -- --force</code>.
        </p>
      )}
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-16 w-72" />
      <Skeleton className="h-40 w-full max-w-2xl" />
    </div>
  );
}

export default function App() {
  const { account } = useWallet();
  return (
    <IconProvider>
      {account ? (
        <ErrorBoundary>
          <Suspense fallback={<DashboardFallback />}>
            <Dashboard key={account.address} account={account} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <Onboarding />
      )}
    </IconProvider>
  );
}
