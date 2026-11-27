import type { ComponentType } from "react";

export type NavIcon = ComponentType<{ size?: number | string; weight?: "regular" | "bold" | "fill" | "duotone" | "light" | "thin"; className?: string }>;

export type NavItem = {
  key: string;
  label: string;
  icon: NavIcon;
  /** Tampil di tab bar bawah (HP). Sisanya masuk Menu. */
  primary?: boolean;
  /** Pengelompokan di sidebar (garis pemisah antar grup). */
  group: number;
};
