import { Suspense, lazy } from "react";
import { useWallet } from "./context/WalletContext";
import Onboarding from "./components/Onboarding";
import { IconProvider, Skeleton } from "./components/ui";

// Dashboard (dan semua panelnya) hanya diunduh setelah dompet dibuka.
const Dashboard = lazy(() => import("./components/Dashboard"));

function DashboardFallback() {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-6 px-6 py-16 sm:px-10">
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
        <Suspense fallback={<DashboardFallback />}>
          <Dashboard key={account.address} account={account} />
        </Suspense>
      ) : (
        <Onboarding />
      )}
    </IconProvider>
  );
}
