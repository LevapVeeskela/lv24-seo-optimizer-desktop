import {
  createContext,
  useContext,
  type PropsWithChildren,
} from "react";
import type { RootStore } from "@/app/model/RootStore";

const StoreContext = createContext<RootStore | null>(null);

export function StoreProvider({
  store,
  children,
}: PropsWithChildren<{ store: RootStore }>) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useRootStore(): RootStore {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useRootStore must be used inside StoreProvider");
  }
  return store;
}
