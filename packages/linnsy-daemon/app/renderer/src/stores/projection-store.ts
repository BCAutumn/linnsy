import { create } from 'zustand';

import { createInitialState, type ProjectionState } from '../features/chat/projection/state.js';

export interface ProjectionStoreSnapshot {
  // 渲染层的唯一真相源：历史回放和 WS 增量都先进入同一个 projection reducer，
  // 再由 React 组件读取这个快照，避免"刷新态"和"实时态"漂移。
  projection: ProjectionState;
}

export function createEmptyProjectionStoreSnapshot(): ProjectionStoreSnapshot {
  return {
    projection: createInitialState(null)
  };
}

export const useProjectionStore = create<ProjectionStoreSnapshot>(() => (
  createEmptyProjectionStoreSnapshot()
));

export function replaceProjectionStore(snapshot: ProjectionStoreSnapshot): void {
  useProjectionStore.setState(snapshot, true);
}
