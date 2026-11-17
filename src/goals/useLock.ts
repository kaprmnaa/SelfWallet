import { useMemo } from "react";
import type { ChainConfig } from "../lib/chains";
import type { Account } from "../lib/vault";
import { blockingGoal } from "./logic";
import { walletRef } from "./ref";
import { useGoals } from "./store";
import type { Goal } from "./types";

/** Goal yang sedang mengunci penarikan di jaringan ini (reaktif terhadap perubahan goal). */
export function useGoalLock(chain: ChainConfig, account: Account): Goal | null {
  const goals = useGoals();
  return useMemo(() => blockingGoal(goals, walletRef(account), chain.chainId), [goals, account, chain.chainId]);
}
