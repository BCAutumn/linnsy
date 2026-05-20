import { describe, expect, test } from 'vitest';

import { delegateToCodexPrompt } from '../delegate-to-codex/prompt.js';
import { linnsyMainPrompt } from '../linnsy-main/prompt.js';

describe('Codex delegation prompts', () => {
  test('main prompt treats Codex as a task executor rather than a chat target', () => {
    expect(linnsyMainPrompt).toContain('Codex is a local task executor, not a chat counterpart');
    expect(linnsyMainPrompt).toContain('If the owner only asks whether Codex is connected');
    expect(linnsyMainPrompt).toContain('do not delegate a task');
  });

  test('main prompt forbids guessed Codex locators', () => {
    expect(linnsyMainPrompt).toContain('Never guess or invent the Codex locator');
    expect(linnsyMainPrompt).toContain('ask one short question before delegating');
    expect(linnsyMainPrompt).toContain('A guessed locator that the adapter rejects is a bad delegation');
  });

  test('main prompt allows Linnsy Work only for artifact-style Codex tasks', () => {
    expect(linnsyMainPrompt).toContain('Project work');
    expect(linnsyMainPrompt).toContain('Artifact work');
    expect(linnsyMainPrompt).toContain('omit locator and let the tool create a visible Linnsy Work directory');
  });

  test('main prompt uses recent task locators as a confirmation signal, not a workspace state', () => {
    expect(linnsyMainPrompt).toContain('use list_tasks for the current conversation');
    expect(linnsyMainPrompt).toContain('compare vendor, locator label/ref, and recency');
    expect(linnsyMainPrompt).toContain('ask for confirmation in natural language when needed');
  });

  test('Codex vendor prompt refuses broad or guessed cwd values', () => {
    expect(delegateToCodexPrompt).toContain('不是 Linnsy 的 task workspace');
    expect(delegateToCodexPrompt).toContain('不是可以随便猜的默认位置');
    expect(delegateToCodexPrompt).toContain('猜 cwd 等于接到一张坏派工单');
  });

  test('Codex vendor prompt recognizes Linnsy Work as a visible default work area', () => {
    expect(delegateToCodexPrompt).toContain('Linnsy Work 子目录');
    expect(delegateToCodexPrompt).toContain('默认干活区');
  });
});
