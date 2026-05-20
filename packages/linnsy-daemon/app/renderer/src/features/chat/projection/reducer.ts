// 投影 reducer 主入口。守住 §3.5 4 条不变量的执行点。
//
//   1) 纯函数：内部不读时间不读全局，全部依赖 state + event
//   2) 幂等：通过 seenEventIds 闸门保证同 eventId 二次 reduce → state 引用不变
//   3) ID 优先：所有合并都走 itemId / runId / messageId，绝不用数组下标
//   4) 回放等价：hydration.ts 内部转换成等价事件序列后走同一个 reduce

import type { ProjectionState } from './state.js';
import type { EventEnvelope } from './types.js';
import { markEventSeen } from './helpers/item-ops.js';
import { reduceInbound } from './projectors/inbound.js';
import { reduceDelta } from './projectors/delta.js';
import { reduceComplete } from './projectors/complete.js';
import { reduceToolCallStart } from './projectors/tool-call-start.js';
import { reduceToolCallProgress } from './projectors/tool-call-progress.js';
import { reduceToolCallResult } from './projectors/tool-call-result.js';
import { reduceSubagentProgress, reduceSubagentSummary } from './projectors/subagent-summary.js';
import { reduceSystemEvent } from './projectors/system-event.js';
import { reduceThoughtComplete, reduceThoughtDelta } from './projectors/thought.js';
import { reduceRunStatusChange } from './projectors/run-status.js';

export function reduce(state: ProjectionState, event: EventEnvelope): ProjectionState {
  if (state.seenEventIds.has(event.eventId)) {
    return state;
  }
  const handled = dispatch(state, event);
  // 即使本事件无业务效果（dispatch 返回的是同一引用），也要把 eventId 记录下来，
  // 防止后续重复事件再次进入业务分支造成 race。
  return markEventSeen(handled, event.eventId);
}

export function reduceAll(state: ProjectionState, events: readonly EventEnvelope[]): ProjectionState {
  let next = state;
  for (const event of events) {
    next = reduce(next, event);
  }
  return next;
}

function dispatch(state: ProjectionState, event: EventEnvelope): ProjectionState {
  switch (event.kind) {
    case 'message.inbound':
      return reduceInbound(state, event);
    case 'message.delta':
      return reduceDelta(state, event);
    case 'message.thought_delta':
      return reduceThoughtDelta(state, event);
    case 'message.thought_complete':
      return reduceThoughtComplete(state, event);
    case 'message.complete':
      return reduceComplete(state, event);
    case 'run.status_change':
      return reduceRunStatusChange(state, event);
    case 'tool_call.start':
      return reduceToolCallStart(state, event);
    case 'tool_call.progress':
      return reduceToolCallProgress(state, event);
    case 'tool_call.result':
      return reduceToolCallResult(state, event);
    case 'subagent.progress':
      return reduceSubagentProgress(state, event);
    case 'subagent.summary':
      return reduceSubagentSummary(state, event);
    case 'system.event':
      return reduceSystemEvent(state, event);
    default:
      return state;
  }
}
