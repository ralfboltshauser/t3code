import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";

export const useThreadMoveDialogState = create<{ source: ScopedThreadRef | null; session: number }>(
  () => ({ source: null, session: 0 }),
);
export function openThreadMove(source: ScopedThreadRef) {
  useThreadMoveDialogState.setState((state) => ({ source, session: state.session + 1 }));
}
export function closeThreadMove() {
  useThreadMoveDialogState.setState({ source: null });
}
