import { describe, expect, test } from 'vitest';

import {
  createStreamCollectorSink,
  readFinalAnswer
} from '../linnkit-graph-executor.js';
import type {
  RuntimeEvent,
  RuntimeEventPublishInput
} from '../../../../observability/definitions/runtime-events.js';
import type { RunExecutorEventPort } from '../types.js';

class CapturingRunExecutorEvents implements RunExecutorEventPort {
  public readonly events: RuntimeEvent[] = [];
  private seq = 0;

  public constructor(private readonly idFactory: () => string = () => `evt_${String(Date.now())}`) {}

  public publish(input: RuntimeEventPublishInput): RuntimeEvent {
    this.seq += 1;
    const base = {
      eventId: this.idFactory(),
      seq: this.seq,
      createdAt: input.createdAt ?? this.seq,
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

// 多 LLM call 同 turn 的字符穿插回归测试。bug 现场（2026-04-27）：
// LLM 第一次出 partial text + tool_call → tool 失败/真调一遍 → 第二次出反思 +
// 真正最终答；两次 stream 各自从 seq=0 开始，sink 给同一 answerId，readFinalAnswer
// 按 seq 全局排序后字符级穿插，用户看到 "好哎的呀的搞抱定歉..." 这种乱码。
describe('createStreamCollectorSink + readFinalAnswer', () => {
  test('rejects non stream_chunk events', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    expect(sink({ type: 'tool_output', content: 'x' })).toEqual([]);
    expect(sink('not an object')).toEqual([]);
  });

  test('assigns globally monotonic seq even when upstream seq restarts', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const callA = [
      sink({ type: 'stream_chunk', content: '好的', seq: 0 })[0],
      sink({ type: 'stream_chunk', content: '搞定！', seq: 1 })[0]
    ].filter((event): event is NonNullable<typeof event> => event !== undefined);
    const callB = [
      sink({ type: 'stream_chunk', content: '抱歉', seq: 0 })[0],
      sink({ type: 'stream_chunk', content: '改了', seq: 1 })[0]
    ].filter((event): event is NonNullable<typeof event> => event !== undefined);

    expect(callA.map((event) => (event.type === 'final_answer_chunk' ? event.seq : -1))).toEqual([0, 1]);
    expect(callB.map((event) => (event.type === 'final_answer_chunk' ? event.seq : -1))).toEqual([2, 3]);
  });

  test('bumps answer_id suffix when upstream seq restarts (no answer_id provided)', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const a0 = sink({ type: 'stream_chunk', content: '好的', seq: 0 })[0];
    const a1 = sink({ type: 'stream_chunk', content: '搞定！', seq: 1 })[0];
    const b0 = sink({ type: 'stream_chunk', content: '抱歉', seq: 0 })[0];
    const b1 = sink({ type: 'stream_chunk', content: '改了', seq: 1 })[0];

    if (a0?.type !== 'final_answer_chunk' || a1?.type !== 'final_answer_chunk' ||
        b0?.type !== 'final_answer_chunk' || b1?.type !== 'final_answer_chunk') {
      throw new Error('expected final_answer_chunk events');
    }
    expect(a0.answer_id).toBe(a1.answer_id);
    expect(b0.answer_id).toBe(b1.answer_id);
    expect(a0.answer_id).not.toBe(b0.answer_id);
  });

  test('bumps answer_id when upstream answer_id changes mid-turn', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const a = sink({ type: 'stream_chunk', content: '好的', answer_id: 'msg_a' })[0];
    const b = sink({ type: 'stream_chunk', content: '抱歉', answer_id: 'msg_b' })[0];
    if (a?.type !== 'final_answer_chunk' || b?.type !== 'final_answer_chunk') {
      throw new Error('expected final_answer_chunk events');
    }
    expect(a.answer_id).toBe('msg_a');
    expect(b.answer_id).toBe('msg_b');
  });

  test('readFinalAnswer returns only the last answer group, not interleaved', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const events = [
      sink({ type: 'stream_chunk', content: '好的，', seq: 0 })[0],
      sink({ type: 'stream_chunk', content: '搞定！', seq: 1 })[0],
      sink({ type: 'stream_chunk', content: '抱歉，', seq: 0 })[0],
      sink({ type: 'stream_chunk', content: '其实', seq: 1 })[0],
      sink({ type: 'stream_chunk', content: '没真调用。', seq: 2 })[0]
    ].filter((event): event is NonNullable<typeof event> => event !== undefined);

    const answer = readFinalAnswer(events, undefined);
    expect(answer).toBe('抱歉，其实没真调用。');
    expect(answer).not.toContain('好');
  });

  test('readFinalAnswer preserves chunk order within a single answer group', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const events = [
      sink({ type: 'stream_chunk', content: '一', seq: 0 })[0],
      sink({ type: 'stream_chunk', content: '二', seq: 1 })[0],
      sink({ type: 'stream_chunk', content: '三', seq: 2 })[0]
    ].filter((event): event is NonNullable<typeof event> => event !== undefined);

    expect(readFinalAnswer(events, undefined)).toBe('一二三');
  });

  // 真实场景（2026-04-27 二次复盘）：LLM stream 把 markdown 列表切成多 chunk，
  // 换行符 \n 通常落在 chunk 起始处（"**A**" / "\n- item1" / "\n\n**B**"）。sink 入口
  // 若 trim() chunk content，就会把 chunk 边界的 \n 全部吃掉，DB 里看到 newlines=0。
  // 这个测试专门盯死 sink 必须保留 chunk 内的所有空白与 \n。
  test('preserves leading/trailing whitespace and \\n inside each chunk content', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const events = [
      sink({ type: 'stream_chunk', content: '**📅日程管理**' })[0],
      sink({ type: 'stream_chunk', content: '\n- 创建定时提醒' })[0],
      sink({ type: 'stream_chunk', content: '\n\n**🤖任务委派**' })[0],
      sink({ type: 'stream_chunk', content: '\n- 把任务派给外部工具' })[0]
    ].filter((event): event is NonNullable<typeof event> => event !== undefined);

    const answer = readFinalAnswer(events, undefined);
    expect(answer).toBe('**📅日程管理**\n- 创建定时提醒\n\n**🤖任务委派**\n- 把任务派给外部工具');
    // \n\n 在中间会切出空 segment（4 个 \n → 5 段），保留就行
    expect(answer?.split('\n').length).toBe(5);
  });

  test('drops only chunks whose content is the empty string, not whitespace-only', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const eventsRaw = [
      sink({ type: 'stream_chunk', content: 'A' })[0],
      // \n\n 紧贴段落分隔——不能被当作"空 chunk"丢弃
      sink({ type: 'stream_chunk', content: '\n\n' })[0],
      sink({ type: 'stream_chunk', content: 'B' })[0],
      // 真正的空字符串才该跳过
      sink({ type: 'stream_chunk', content: '' })[0]
    ];
    const events = eventsRaw.filter((event): event is NonNullable<typeof event> => event !== undefined);

    expect(eventsRaw[3]).toBeUndefined();
    expect(readFinalAnswer(events, undefined)).toBe('A\n\nB');
  });

  test('readFinalAnswer prefers a terminal final_answer event over chunks', () => {
    const sink = createStreamCollectorSink('conv_1', 'turn_1');
    const chunkEvents = [
      sink({ type: 'stream_chunk', content: 'partial', seq: 0 })[0]
    ].filter((event): event is NonNullable<typeof event> => event !== undefined);

    const terminal = {
      type: 'final_answer' as const,
      id: 'final_1',
      conversation_id: 'conv_1',
      turn_id: 'turn_1',
      timestamp: 1,
      version: 1 as const,
      answer_id: 'answer_turn_1',
      content: 'authoritative answer',
      is_complete: true
    };

    expect(readFinalAnswer([...chunkEvents, terminal], undefined)).toBe('authoritative answer');
  });

  test('publishes message.delta events for renderer streaming', () => {
    const events = new CapturingRunExecutorEvents(() => 'evt_delta');
    const sink = createStreamCollectorSink({
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runId: 'run_1',
      events
    });

    sink({ type: 'stream_chunk', content: 'hello', seq: 0, timestamp: 456 });

    const event = events.events[0];
    expect(event?.eventId).toBe('evt_delta');
    expect(event?.kind).toBe('message.delta');
    expect(event?.conversationId).toBe('conv_1');
    expect(event?.runId).toBe('run_1');
    expect(event?.createdAt).toBe(456);
    expect(event?.payload).toMatchObject({
      turnId: 'turn_1',
      chunkSeq: 0,
      delta: 'hello'
    });
  });

  test('publishes distinct renderer answerId groups when upstream stream seq restarts', () => {
    let nextId = 1;
    const events = new CapturingRunExecutorEvents(() => `evt_delta_${String(nextId++)}`);
    const sink = createStreamCollectorSink({
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runId: 'run_1',
      events
    });

    sink({ type: 'stream_chunk', content: '先答', seq: 0, timestamp: 10 });
    sink({ type: 'stream_chunk', content: '一段', seq: 1, timestamp: 11 });
    sink({ type: 'stream_chunk', content: '再答', seq: 0, timestamp: 12 });

    expect(events.events.map((event) => event.kind)).toEqual([
      'message.delta',
      'message.delta',
      'message.delta'
    ]);
    expect(events.events).toMatchObject([
      { payload: { answerId: 'answer_turn_1' } },
      { payload: { answerId: 'answer_turn_1' } },
      { payload: { answerId: 'answer_turn_1#1' } }
    ]);
  });

  test('publishes thought delta and complete events for renderer projection', () => {
    let nextId = 1;
    const events = new CapturingRunExecutorEvents(() => `evt_${String(nextId++)}`);
    const sink = createStreamCollectorSink({
      conversationId: 'conv_1',
      turnId: 'turn_1',
      runId: 'run_1',
      events
    });

    const deltaEvents = sink({
      type: 'thought',
      id: 'thought_delta_1',
      thought_message_id: 'thought_1',
      delta: '我先梳理一下',
      content: '',
      is_complete: false,
      timestamp: 456
    });
    const completeEvents = sink({
      type: 'thought',
      id: 'thought_complete_1',
      thought_message_id: 'thought_1',
      content: '我先梳理一下',
      is_complete: true,
      timestamp: 457
    });

    expect(deltaEvents[0]?.type).toBe('thought');
    expect(completeEvents[0]?.type).toBe('thought');
    expect(events.events.map((event) => event.kind)).toEqual([
      'message.thought_delta',
      'message.thought_complete'
    ]);
    expect(events.events[0]).toMatchObject({
      conversationId: 'conv_1',
      runId: 'run_1',
      createdAt: 456,
      payload: {
        turnId: 'turn_1',
        thoughtId: 'thought_1',
        chunk: '我先梳理一下',
        chunkSeq: 0
      }
    });
    expect(events.events[1]).toMatchObject({
      createdAt: 457,
      payload: {
        thoughtId: 'thought_1',
        text: '我先梳理一下'
      }
    });
  });
});
