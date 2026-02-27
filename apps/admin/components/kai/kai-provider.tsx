"use client";

import { useReducer } from "react";
import { KaiContext, kaiReducer, kaiInitialState } from "@/lib/hooks/use-kai";

export function KaiProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(kaiReducer, kaiInitialState);

  return (
    <KaiContext.Provider value={{ state, dispatch }}>
      {children}
    </KaiContext.Provider>
  );
}
