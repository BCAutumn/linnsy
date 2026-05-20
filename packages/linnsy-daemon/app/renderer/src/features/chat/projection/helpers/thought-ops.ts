import type { AssistantThoughtChunk } from '../types.js';

export function completeThoughtChunks(
  chunks: readonly AssistantThoughtChunk[],
  completedAt: number
): readonly AssistantThoughtChunk[] {
  if (chunks.every((chunk) => chunk.completed)) {
    return chunks;
  }
  return chunks.map((chunk) => chunk.completed
    ? chunk
    : {
        ...chunk,
        completed: true,
        updatedAt: completedAt,
        completedAt
      });
}
