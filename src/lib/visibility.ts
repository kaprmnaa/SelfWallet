import { useEffect, useRef } from "react";

/**
 * setInterval yang berhenti saat tab/aplikasi di latar belakang, dan langsung
 * menjalankan callback sekali lagi saat kembali terlihat. Hemat baterai dan kuota di HP.
 */
export function useVisibleInterval(cb: () => void, ms: number) {
  const saved = useRef(cb);
  saved.current = cb;

  useEffect(() => {
    let id: number | undefined;
    const start = () => {
      if (id === undefined) id = window.setInterval(() => saved.current(), ms);
    };
    const stop = () => {
      if (id !== undefined) {
        window.clearInterval(id);
        id = undefined;
      }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        saved.current();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);
}
