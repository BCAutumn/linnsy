import { describe, expect, test } from 'vitest';

import type {
  OpenAIToolSchema,
  ToolExecutionContext
} from '@linnlabs/linnkit/runtime-kernel';

import { createLinnsyToolRuntime } from '../tool-runtime.js';
import { createPolicyScopedToolRuntime } from '../../run-executor/policy-scoped-tool-runtime.js';
import type {
  LinnsyTool,
  ToolRuntimeEventPort
} from '../types.js';
import type {
  RuntimeEvent,
  RuntimeEventPublishInput
} from '../../../../observability/definitions/runtime-events.js';

// 守 §S2.2a：tool-runtime publish tool_call.start / tool_call.result 在 4 个分支：
// 1) 注册工具成功执行 → start + result(success)
// 2) 注册工具抛错 → start + result(error, errorKind=execution)
// 3) 工具未注册 → 仅 result(error, errorKind=protocol)
// 4) 策略禁止（policy-scoped 层） → 仅 result(blocked)

function fakeTool(name: string, behaviour: 'success' | 'throw' | 'empty-observation'): LinnsyTool {
  const parameters = { type: 'object' as const, properties: {} };
  const schema: OpenAIToolSchema = {
    type: 'function',
    function: { name, description: name, parameters }
  };
  return {
    name,
    description: `${name} test fixture`,
    definition: { parameters },
    getSchema: () => schema,
    execute(args: Record<string, unknown>) {
      if (behaviour === 'throw') return Promise.reject(new Error('tool blew up'));
      if (behaviour === 'empty-observation') {
        return Promise.resolve({ data: { ok: true }, observation: '' });
      }
      return Promise.resolve({
        data: { ok: true, args },
        observation: `fake ${name} executed`
      });
    }
  };
}

const baseContext: ToolExecutionContext = {
  runId: 'run_1',
  conversationId: 'conv_1',
  turnId: 'turn_1',
  parentToolCallId: 'tc_1'
};

class CapturingToolRuntimeEvents implements ToolRuntimeEventPort {
  public readonly events: RuntimeEvent[] = [];
  private seq = 0;

  public constructor(
    private readonly idFactory: () => string,
    private readonly now: () => number
  ) {}

  public publish(input: RuntimeEventPublishInput): RuntimeEvent {
    this.seq += 1;
    const base = {
      eventId: this.idFactory(),
      seq: this.seq,
      createdAt: input.createdAt ?? this.now(),
      ...(input.conversationId === undefined ? {} : { conversationId: input.conversationId }),
      ...(input.messageId === undefined ? {} : { messageId: input.messageId }),
      ...(input.runId === undefined ? {} : { runId: input.runId })
    };
    const event = buildRuntimeEventForTest(input, base);
    this.events.push(event);
    return event;
  }
}

interface RuntimeEventBaseForTest {
  eventId: string;
  seq: number;
  createdAt: number;
  conversationId?: string;
  messageId?: string;
  runId?: string;
}

function buildRuntimeEventForTest(input: RuntimeEventPublishInput, base: RuntimeEventBaseForTest): RuntimeEvent {
  switch (input.kind) {
    case 'message.inbound':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.delta':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.thought_delta':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.thought_complete':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'message.complete':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'run.status_change':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.start':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.progress':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'tool_call.result':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'subagent.progress':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'subagent.summary':
      return { ...base, kind: input.kind, payload: input.payload };
    case 'system.event':
      return { ...base, kind: input.kind, payload: input.payload };
  }
}

describe('tool-runtime · publishes tool_call lifecycle events', () => {
  test('success: emits tool_call.start then tool_call.result(success)', async () => {
    const events = new CapturingToolRuntimeEvents(makeIdFactory(), () => 100);
    const runtime = createLinnsyToolRuntime({
      events,
      tools: [fakeTool('list_tasks', 'success')]
    });

    const result = await runtime.executeTool('list_tasks', { foo: 'bar' }, baseContext);
    expect(result.success).toBe(true);

    expect(events.events.map((e) => e.kind)).toEqual(['tool_call.start', 'tool_call.result']);
    const [startEvent, resultEvent] = events.events;
    if (startEvent?.kind !== 'tool_call.start' || resultEvent?.kind !== 'tool_call.result') {
      throw new Error('unexpected event kinds');
    }
    expect(startEvent.payload).toMatchObject({
      toolCallId: 'tc_1',
      toolName: 'list_tasks',
      args: { foo: 'bar' },
      turnId: 'turn_1'
    });
    expect(resultEvent.payload).toMatchObject({
      toolCallId: 'tc_1',
      toolName: 'list_tasks',
      status: 'success'
    });
    expect(resultEvent.payload.data).toEqual({ ok: true, args: { foo: 'bar' } });
    expect(resultEvent.payload.observation).toBe('fake list_tasks executed');
  });

  test('execution error: emits start + result(error, errorKind=execution)', async () => {
    const events = new CapturingToolRuntimeEvents(makeIdFactory(), () => 200);
    const runtime = createLinnsyToolRuntime({
      events,
      tools: [fakeTool('cron_set', 'throw')]
    });

    const result = await runtime.executeTool('cron_set', {}, baseContext);
    expect(result.success).toBe(false);

    expect(events.events.map((e) => e.kind)).toEqual(['tool_call.start', 'tool_call.result']);
    const errResult = events.events[1];
    if (errResult?.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(errResult.payload).toMatchObject({
      status: 'error',
      errorKind: 'execution',
      error: 'tool blew up'
    });
  });

  test('protocol error: empty observation is rejected before publishing success data', async () => {
    const events = new CapturingToolRuntimeEvents(makeIdFactory(), () => 250);
    const runtime = createLinnsyToolRuntime({
      events,
      tools: [fakeTool('bad_tool', 'empty-observation')]
    });

    const result = await runtime.executeTool('bad_tool', {}, baseContext);
    expect(result).toMatchObject({
      success: false,
      errorKind: 'execution'
    });

    expect(events.events.map((e) => e.kind)).toEqual(['tool_call.start', 'tool_call.result']);
    const errResult = events.events[1];
    if (errResult?.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(errResult.payload).toMatchObject({
      toolName: 'bad_tool',
      status: 'error',
      errorKind: 'execution',
      error: 'tool bad_tool returned invalid StructuredToolResult.observation'
    });
    expect(errResult.payload.data).toBeUndefined();
    expect(errResult.payload.observation).toBeUndefined();
  });

  test('unregistered tool: emits only result(error, errorKind=protocol)', async () => {
    const events = new CapturingToolRuntimeEvents(makeIdFactory(), () => 300);
    const runtime = createLinnsyToolRuntime({ events });

    await runtime.executeTool('unknown_tool', {}, baseContext);
    expect(events.events.map((e) => e.kind)).toEqual(['tool_call.result']);
    const event = events.events[0];
    if (event?.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(event.payload).toMatchObject({
      toolName: 'unknown_tool',
      status: 'error',
      errorKind: 'protocol'
    });
  });

  test('policy blocked: emits only result(blocked) at policy-scoped layer', async () => {
    const events = new CapturingToolRuntimeEvents(makeIdFactory(), () => 400);
    const baseRuntime = createLinnsyToolRuntime({
      // 故意不传 events，让 base 层不发——只让 policy 层在 blocked 分支发一条。
      tools: [fakeTool('cron_set', 'success')]
    });
    const scoped = createPolicyScopedToolRuntime(baseRuntime, { events });
    scoped.setAllowedToolIdsForRun('run_1', ['list_tasks']); // cron_set 不在白名单

    const result = await scoped.executeTool('cron_set', {}, baseContext);
    expect(result.success).toBe(false);

    expect(events.events.map((e) => e.kind)).toEqual(['tool_call.result']);
    const blocked = events.events[0];
    if (blocked?.kind !== 'tool_call.result') throw new Error('expected tool_call.result');
    expect(blocked.payload).toMatchObject({
      toolName: 'cron_set',
      status: 'blocked',
      durationMs: 0
    });
  });
});

function makeIdFactory(): () => string {
  let n = 0;
  return () => `evt_${String(++n)}`;
}
