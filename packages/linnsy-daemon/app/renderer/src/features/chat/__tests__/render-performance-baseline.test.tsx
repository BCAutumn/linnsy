// @vitest-environment happy-dom

// S4.0 性能基线：固定长对话脚本 + projection reducer + React 真实渲染。
//
// 这不是硬阈值测试。happy-dom 的耗时不能代表 Chromium 绝对表现，只能作为后续
// S4.1 / S4.2 / S4.3 优化前后的相对比较基线。测试只断言脚本规模与指标形态稳定。

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test } from 'vitest';

import { reduce, reduceAll } from '../projection/reducer.js';
import { createInitialState } from '../projection/state.js';
import { resetFlushIntervalMs, setFlushIntervalMs } from '../projection/settings.js';
import { selectAllItems } from '../projection/helpers/selectors.js';
import { resetFixtureCounters } from '../projection/__tests__/fixtures.js';
import { createRuntimeEventBatcher } from '../../../lib/runtime-event-batcher.js';
import {
  createBaselineScript,
  createToolCardItems,
  nextAnimationFrame,
  percentile,
  readHeapUsedBytes,
  renderItems,
  roundToTwoDecimals,
  type BaselineMetrics,
  type ToolToggleMetrics
} from './render-performance-baseline-support.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  resetFlushIntervalMs();
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
});

describe('chat render performance baseline · S4', () => {
  test('replays long markdown stream + tool cards over 200 historical messages', async () => {
    resetFixtureCounters();
    const script = createBaselineScript();
    let state = reduceAll(createInitialState('conv_perf'), script.historyEvents);
    const heapBefore = readHeapUsedBytes();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderItems(root, selectAllItems(state));

    const frameIntervals: number[] = [];
    const renderDurations: number[] = [];
    let previousFrameAt = await nextAnimationFrame();

    for (const event of script.replayEvents) {
      state = reduce(state, event);
      const startedAt = performance.now();
      renderItems(root, selectAllItems(state));
      renderDurations.push(performance.now() - startedAt);
      const frameAt = await nextAnimationFrame();
      frameIntervals.push(frameAt - previousFrameAt);
      previousFrameAt = frameAt;
    }

    const heapAfter = readHeapUsedBytes();
    const metrics: BaselineMetrics = {
      historyMessageCount: script.historyMessageCount,
      markdownChars: script.markdownText.length,
      streamChunkCount: script.streamChunkCount,
      toolCallCount: script.toolCallCount,
      updateCount: script.replayEvents.length,
      renderUpdateCount: script.replayEvents.length,
      maxBatchSize: 1,
      frameMedianMs: percentile(frameIntervals, 0.5),
      frameP95Ms: percentile(frameIntervals, 0.95),
      frameP99Ms: percentile(frameIntervals, 0.99),
      renderMedianMs: percentile(renderDurations, 0.5),
      renderP95Ms: percentile(renderDurations, 0.95),
      renderP99Ms: percentile(renderDurations, 0.99),
      longTaskCount: renderDurations.filter((duration) => duration > 50).length,
      heapDeltaMb: heapBefore === null || heapAfter === null
        ? null
        : roundToTwoDecimals((heapAfter - heapBefore) / 1024 / 1024)
    };

    console.info('[S4.0 chat render baseline]', JSON.stringify(metrics));
    expect(metrics.historyMessageCount).toBe(200);
    expect(metrics.markdownChars).toBeGreaterThanOrEqual(5000);
    expect(metrics.streamChunkCount).toBe(50);
    expect(metrics.toolCallCount).toBe(30);
    expect(metrics.updateCount).toBe(110);
    expect(metrics.renderUpdateCount).toBe(metrics.updateCount);
    expect(metrics.maxBatchSize).toBe(1);
    expect(metrics.frameP95Ms).toBeGreaterThanOrEqual(metrics.frameMedianMs);
    expect(metrics.renderP95Ms).toBeGreaterThanOrEqual(metrics.renderMedianMs);
    expect(metrics.longTaskCount).toBeGreaterThanOrEqual(0);
  });

  test('replays the same script through S4.1 runtime event batcher', async () => {
    resetFixtureCounters();
    setFlushIntervalMs(33);
    const script = createBaselineScript();
    let state = reduceAll(createInitialState('conv_perf'), script.historyEvents);
    const heapBefore = readHeapUsedBytes();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const activeRoot = root;
    renderItems(activeRoot, selectAllItems(state));

    const frameIntervals: number[] = [];
    const renderDurations: number[] = [];
    const batchSizes: number[] = [];
    let previousFrameAt = await nextAnimationFrame();

    const batcher = createRuntimeEventBatcher({
      apply(events) {
        batchSizes.push(events.length);
        const previousState = state;
        const startedAt = performance.now();
        state = reduceAll(state, events);
        if (state === previousState) {
          return;
        }
        renderItems(activeRoot, selectAllItems(state));
        renderDurations.push(performance.now() - startedAt);
      }
    });

    for (const event of script.replayEvents) {
      const renderCountBefore = renderDurations.length;
      batcher.push(event);
      if (renderDurations.length > renderCountBefore) {
        const frameAt = await nextAnimationFrame();
        frameIntervals.push(frameAt - previousFrameAt);
        previousFrameAt = frameAt;
      }
    }
    const renderCountBeforeFlush = renderDurations.length;
    batcher.flush();
    if (renderDurations.length > renderCountBeforeFlush) {
      const frameAt = await nextAnimationFrame();
      frameIntervals.push(frameAt - previousFrameAt);
    }
    batcher.close();

    const heapAfter = readHeapUsedBytes();
    const metrics: BaselineMetrics = {
      historyMessageCount: script.historyMessageCount,
      markdownChars: script.markdownText.length,
      streamChunkCount: script.streamChunkCount,
      toolCallCount: script.toolCallCount,
      updateCount: script.replayEvents.length,
      renderUpdateCount: renderDurations.length,
      maxBatchSize: Math.max(...batchSizes),
      frameMedianMs: percentile(frameIntervals, 0.5),
      frameP95Ms: percentile(frameIntervals, 0.95),
      frameP99Ms: percentile(frameIntervals, 0.99),
      renderMedianMs: percentile(renderDurations, 0.5),
      renderP95Ms: percentile(renderDurations, 0.95),
      renderP99Ms: percentile(renderDurations, 0.99),
      longTaskCount: renderDurations.filter((duration) => duration > 50).length,
      heapDeltaMb: heapBefore === null || heapAfter === null
        ? null
        : roundToTwoDecimals((heapAfter - heapBefore) / 1024 / 1024)
    };

    console.info('[S4.1 chat render batched baseline]', JSON.stringify(metrics));
    expect(metrics.historyMessageCount).toBe(200);
    expect(metrics.markdownChars).toBeGreaterThanOrEqual(5000);
    expect(metrics.streamChunkCount).toBe(50);
    expect(metrics.toolCallCount).toBe(30);
    expect(metrics.updateCount).toBe(110);
    expect(metrics.renderUpdateCount).toBeLessThan(metrics.updateCount);
    expect(metrics.maxBatchSize).toBeGreaterThan(1);
    expect(metrics.frameP95Ms).toBeGreaterThanOrEqual(metrics.frameMedianMs);
    expect(metrics.renderP95Ms).toBeGreaterThanOrEqual(metrics.renderMedianMs);
    expect(metrics.longTaskCount).toBeGreaterThanOrEqual(0);
  });

  test('toggles 50 folded tool cards without mounting body content while collapsed', () => {
    const items = createToolCardItems(50);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const activeRoot = root;
    renderItems(activeRoot, items);

    const headers = [...container.querySelectorAll<HTMLButtonElement>('.tool-card__header')];
    expect(headers).toHaveLength(50);
    expect(container.querySelectorAll('.tool-card__body')).toHaveLength(0);
    expect(container.querySelectorAll('.tool-card__pre')).toHaveLength(0);

    const expandDurations: number[] = [];
    for (const header of headers) {
      const startedAt = performance.now();
      act(() => { header.click(); });
      expandDurations.push(performance.now() - startedAt);
    }

    expect(container.querySelectorAll('.tool-card__body')).toHaveLength(50);
    expect(container.querySelectorAll('.tool-card__pre')).toHaveLength(150);

    const collapseDurations: number[] = [];
    for (const header of headers) {
      const startedAt = performance.now();
      act(() => { header.click(); });
      collapseDurations.push(performance.now() - startedAt);
    }

    const metrics: ToolToggleMetrics = {
      toolCallCount: items.length,
      collapsedBodyCount: container.querySelectorAll('.tool-card__body').length,
      collapsedPreCount: container.querySelectorAll('.tool-card__pre').length,
      expandedBodyCount: 50,
      expandedPreCount: 150,
      expandMedianMs: percentile(expandDurations, 0.5),
      expandP95Ms: percentile(expandDurations, 0.95),
      collapseMedianMs: percentile(collapseDurations, 0.5),
      collapseP95Ms: percentile(collapseDurations, 0.95)
    };

    console.info('[S4.3 tool card toggle baseline]', JSON.stringify(metrics));
    expect(metrics.collapsedBodyCount).toBe(0);
    expect(metrics.collapsedPreCount).toBe(0);
    expect(metrics.expandP95Ms).toBeGreaterThanOrEqual(metrics.expandMedianMs);
    expect(metrics.collapseP95Ms).toBeGreaterThanOrEqual(metrics.collapseMedianMs);
  });
});
