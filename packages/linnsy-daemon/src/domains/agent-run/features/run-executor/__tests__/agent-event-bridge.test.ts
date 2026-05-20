import { describe, expect, test } from 'vitest';

import { mapAgentProcessEventToRuntimeInputs } from '../agent-event-bridge.js';

const context = {
  conversationId: 'conv_main',
  turnId: 'turn_1',
  runId: 'run_parent'
};

describe('agent-event-bridge', () => {
  test('maps linnkit tool_process to Linnsy tool_call.progress', () => {
    const inputs = mapAgentProcessEventToRuntimeInputs({
      type: 'tool_process',
      id: 'evt_linnkit_tool_process',
      conversation_id: 'conv_main',
      turn_id: 'turn_1',
      timestamp: 100,
      tool_call_id: 'tc_1',
      tool_name: 'delegate_to_internal',
      phase: 'update',
      status: 'loading',
      payload: { message: '子任务正在执行' }
    }, context);

    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    expect(input).toMatchObject({
      kind: 'tool_call.progress',
      conversationId: 'conv_main',
      runId: 'run_parent'
    });
    if (input?.kind !== 'tool_call.progress') throw new Error('expected tool_call.progress');
    expect(input.payload.toolCallId).toBe('tc_1');
    expect(input.payload.detail).toBe('子任务正在执行');
  });

  test('maps linnkit subrun_trace to Linnsy subagent.progress', () => {
    const inputs = mapAgentProcessEventToRuntimeInputs({
      type: 'subrun_trace',
      id: 'evt_linnkit_subrun',
      conversation_id: 'conv_main',
      turn_id: 'turn_1',
      timestamp: 120,
      parent_tool_call_id: 'tc_delegate',
      subrun_id: 'run_child',
      kind: 'tool_process',
      tool_name: 'web_research',
      tool_call_id: 'tc_child_tool',
      phase: 'update',
      status: 'loading',
      content: '正在检索资料'
    }, context);

    expect(inputs).toHaveLength(1);
    const input = inputs[0];
    if (input?.kind !== 'subagent.progress') throw new Error('expected subagent.progress');
    expect(input.payload.childRunId).toBe('run_child');
    expect(input.payload.parentToolCallId).toBe('tc_delegate');
    expect(input.payload.detail).toBe('正在检索资料');
  });

  test('ignores incomplete or unsupported process events', () => {
    expect(mapAgentProcessEventToRuntimeInputs({ type: 'stream_chunk' }, context)).toEqual([]);
    expect(mapAgentProcessEventToRuntimeInputs({
      type: 'tool_process',
      timestamp: 1,
      tool_name: 'missing_id',
      phase: 'update',
      status: 'loading'
    }, context)).toEqual([]);
  });
});
