import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { CreateFlow, ImportFlow, UnlockForm } from "./Onboarding";
import { Modal, Tabs } from "./ui";

export type AddTab = "create" | "import" | "unlock";

const TABS: { key: AddTab; label: string }[] = [
  { key: "create", label: "Buat baru" },
  { key: "import", label: "Impor" },
  { key: "unlock", label: "Buka" },
];

/**
 * Tidak bisa ditutup dengan klik di luar / Escape: menutup di tengah proses "Buat baru"
 * bisa menghilangkan wallet yang recovery phrase-nya belum dicatat.
 */
export default function AddWalletModal({
  open,
  onClose,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  initialTab: AddTab;
}) {
  const [tab, setTab] = useState<AddTab>(initialTab);
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  return (
    <Modal open={open} onClose={onClose} title="Tambah wallet" dismissible={false}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup"
        className="absolute right-5 top-5 grid size-8 place-items-center rounded-lg text-zinc-500 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-100"
      >
        <X />
      </button>
      <div className="grid gap-6">
        <Tabs items={TABS} value={tab} onChange={setTab} id="add-wallet" />
        <div key={tab}>
          {tab === "create" && <CreateFlow onDone={onClose} />}
          {tab === "import" && <ImportFlow onDone={onClose} />}
          {tab === "unlock" && <UnlockForm onDone={onClose} />}
        </div>
      </div>
    </Modal>
  );
}
