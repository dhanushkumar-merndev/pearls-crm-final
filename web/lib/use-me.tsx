"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Me } from "./session";

const MeContext = createContext<Me | null>(null);

/** The signed-in staff member, for client screens (role-based buttons). The database still decides. */
export function MeProvider({ me, children }: { me: Me; children: ReactNode }) {
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

export function useMe(): Me | null {
  return useContext(MeContext);
}
