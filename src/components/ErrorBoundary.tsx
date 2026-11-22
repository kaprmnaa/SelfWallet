import { Component, type ErrorInfo, type ReactNode } from "react";

/** Tangkap galat render/pemuatan modul supaya layar tidak kosong atau menggantung tanpa penjelasan. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Kunci] Galat tampilan:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="grid min-h-[100dvh] place-items-center px-6">
        <div className="glass-surface glass-rim grid w-full max-w-sm gap-4 rounded-[2rem] p-7">
          <h1 className="text-lg font-medium tracking-tight text-zinc-50">Terjadi kesalahan</h1>
          <p className="break-words font-mono text-xs text-rose-300">{this.state.error.message || String(this.state.error)}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary rounded-xl px-5 py-3 text-sm font-medium">
            Muat ulang
          </button>
        </div>
      </main>
    );
  }
}
