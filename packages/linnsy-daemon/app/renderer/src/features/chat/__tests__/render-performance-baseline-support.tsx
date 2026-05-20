import React from 'react';
import { act } from 'react';
import type { Root } from 'react-dom/client';

import { Message } from '../items/Message.js';
import type { ConversationItem, EventEnvelope, ToolCallCardItem } from '../projection/types.js';
import {
  complete,
  delta,
  inbound,
  toolCallResult,
  toolCallStart
} from '../projection/__tests__/fixtures.js';

export interface BaselineMetrics {
  historyMessageCount: number;
  markdownChars: number;
  streamChunkCount: number;
  toolCallCount: number;
  updateCount: number;
  renderUpdateCount: number;
  maxBatchSize: number;
  frameMedianMs: number;
  frameP95Ms: number;
  frameP99Ms: number;
  renderMedianMs: number;
  renderP95Ms: number;
  renderP99Ms: number;
  longTaskCount: number;
  heapDeltaMb: number | null;
}

export interface ToolToggleMetrics {
  toolCallCount: number;
  collapsedBodyCount: number;
  collapsedPreCount: number;
  expandedBodyCount: number;
  expandedPreCount: number;
  expandMedianMs: number;
  expandP95Ms: number;
  collapseMedianMs: number;
  collapseP95Ms: number;
}

export function renderItems(target: Root, items: readonly ConversationItem[]): void {
  act(() => {
    target.render(
      <article aria-label="performance baseline" className="message-list">
        {items.map((item) => (
          <Message item={item} key={item.id} locale="zh-CN" />
        ))}
      </article>
    );
  });
}

export function createBaselineScript(): {
  historyEvents: EventEnvelope[];
  replayEvents: EventEnvelope[];
  historyMessageCount: number;
  markdownText: string;
  streamChunkCount: number;
  toolCallCount: number;
} {
  const historyEvents: EventEnvelope[] = [];
  for (let index = 0; index < 100; index += 1) {
    const createdAt = index * 2 + 1;
    historyEvents.push(inbound({
      conversationId: 'conv_perf',
      message: {
        conversationId: 'conv_perf',
        messageId: `hist_user_${String(index)}`,
        role: 'user',
        source: 'inbound',
        text: `历史问题 ${String(index)}：帮我整理上一轮事项。`,
        createdAt
      }
    }));
    historyEvents.push(complete({
      conversationId: 'conv_perf',
      runId: `hist_run_${String(index)}`,
      message: {
        conversationId: 'conv_perf',
        messageId: `hist_assistant_${String(index)}`,
        role: 'assistant',
        source: 'outbound',
        text: `历史回复 ${String(index)}：已记录，并补充一个可执行下一步。`,
        runId: `hist_run_${String(index)}`,
        createdAt: createdAt + 1
      }
    }));
  }

  const markdownText = createLongMarkdown();
  const chunks = splitIntoChunks(markdownText, 50);
  const replayEvents: EventEnvelope[] = [];
  for (const [index, chunk] of chunks.entries()) {
    replayEvents.push(delta({
      conversationId: 'conv_perf',
      runId: 'run_perf',
      turnId: 'turn_perf',
      answerId: 'answer_perf',
      chunkSeq: index,
      delta: chunk,
      createdAt: 1_000 + index
    }));
  }
  for (let index = 0; index < 30; index += 1) {
    replayEvents.push(toolCallStart({
      conversationId: 'conv_perf',
      runId: 'run_perf',
      toolCallId: `tool_perf_${String(index)}`,
      toolName: 'baseline.echo',
      args: {
        index,
        query: 'baseline',
        payload: `工具入参 ${String(index)} `.repeat(8)
      },
      startedAt: 2_000 + index * 2,
      createdAt: 2_000 + index * 2
    }));
    replayEvents.push(toolCallResult({
      conversationId: 'conv_perf',
      runId: 'run_perf',
      toolCallId: `tool_perf_${String(index)}`,
      toolName: 'baseline.echo',
      status: 'success',
      data: { index, text: `工具结果 ${String(index)} `.repeat(12) },
      observation: `工具结果 ${String(index)} `.repeat(12),
      durationMs: 12,
      endedAt: 2_001 + index * 2,
      createdAt: 2_001 + index * 2
    }));
  }

  return {
    historyEvents,
    replayEvents,
    historyMessageCount: historyEvents.length,
    markdownText,
    streamChunkCount: chunks.length,
    toolCallCount: 30
  };
}

function createLongMarkdown(): string {
  const sections: string[] = [];
  for (let index = 0; index < 18; index += 1) {
    sections.push([
      `### 第 ${String(index + 1)} 段`,
      '',
      `这是一段用于性能基线的长 markdown。它包含中文、粗体 **重点 ${String(index)}**、链接 [docs](https://example.com) 和列表。`,
      '',
      `- 第一项：${'滚动和渲染必须稳定。'.repeat(4)}`,
      `- 第二项：${'流式 chunk 不能丢字。'.repeat(4)}`,
      `- 第三项：${'markdown 重解析是当前观察热点。'.repeat(3)}`,
      '',
      '```ts',
      `const baseline${String(index)} = "measure before optimizing";`,
      '```'
    ].join('\n'));
  }
  return sections.join('\n\n');
}

function splitIntoChunks(text: string, chunkCount: number): string[] {
  const chunkSize = Math.ceil(text.length / chunkCount);
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    chunks.push(text.slice(offset, offset + chunkSize));
  }
  return chunks;
}

export function createToolCardItems(count: number): ToolCallCardItem[] {
  const items: ToolCallCardItem[] = [];
  for (let index = 0; index < count; index += 1) {
    items.push({
      kind: 'tool_call_card',
      id: `tool:toggle_${String(index)}`,
      conversationId: 'conv_perf',
      createdAt: 3_000 + index,
      toolCallId: `tool_toggle_${String(index)}`,
      toolName: 'baseline.heavy',
      status: 'success',
      args: {
        index,
        payload: `折叠态不应该格式化这段入参 ${String(index)} `.repeat(16)
      },
      data: { index, text: `工具结果 ${String(index)} `.repeat(24) },
      observation: `工具结果 ${String(index)} `.repeat(24),
      durationMs: 12,
      startedAt: 3_000 + index,
      endedAt: 3_001 + index,
      runId: 'run_perf'
    });
  }
  return items;
}

export function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame((timestamp) => {
      resolve(timestamp);
    });
  });
}

export function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return roundToTwoDecimals(sorted[index] ?? 0);
}

export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export function readHeapUsedBytes(): number | null {
  return typeof process !== 'undefined' ? process.memoryUsage().heapUsed : null;
}
