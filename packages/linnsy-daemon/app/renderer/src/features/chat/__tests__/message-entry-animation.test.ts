import { describe, expect, test } from 'vitest';

import {
  createInitialMessageEntryAnimationState,
  deriveMessageEntryAnimation
} from '../message-entry-animation.js';

describe('message entry animation', () => {
  test('does not animate the first hydrated snapshot', () => {
    const result = deriveMessageEntryAnimation(
      createInitialMessageEntryAnimationState(),
      'conv_1',
      [entry('msg_1'), entry('msg_2')]
    );

    expect([...result.animatedItemIds]).toEqual([]);
    expect([...result.nextState.seenItemIds]).toEqual(['msg_1', 'msg_2']);
  });

  test('animates only item ids first seen after the initial snapshot', () => {
    const initial = deriveMessageEntryAnimation(
      createInitialMessageEntryAnimationState(),
      'conv_1',
      [entry('msg_1')]
    );
    const next = deriveMessageEntryAnimation(initial.nextState, 'conv_1', [
      entry('msg_1'),
      entry('msg_2'),
      entry('tool_1')
    ]);

    expect([...next.animatedItemIds]).toEqual(['msg_2', 'tool_1']);
  });

  test('does not animate an assistant bubble when stream id swaps to the final message id', () => {
    const streaming = deriveMessageEntryAnimation(
      createInitialMessageEntryAnimationState(),
      'conv_1',
      [entry('stream:run_1:answer_1', 'assistant:conv_1:run_1')]
    );
    const settled = deriveMessageEntryAnimation(streaming.nextState, 'conv_1', [
      entry('msg_final', 'assistant:conv_1:run_1')
    ]);

    expect([...settled.animatedItemIds]).toEqual([]);
  });

  test('animates a second assistant answer when it appears as a new visual row', () => {
    const firstAnswer = deriveMessageEntryAnimation(
      createInitialMessageEntryAnimationState(),
      'conv_1',
      [
        entry('stream:run_1:answer_1', 'assistant:conv_1:run_1'),
        entry('tool_1')
      ]
    );
    const secondAnswer = deriveMessageEntryAnimation(firstAnswer.nextState, 'conv_1', [
      entry('msg_answer_1', 'assistant:conv_1:run_1'),
      entry('tool_1'),
      entry('stream:run_1:answer_2', 'assistant:conv_1:run_1')
    ]);

    expect([...secondAnswer.animatedItemIds]).toEqual(['stream:run_1:answer_2']);
  });

  test('does not replay animations when switching conversations or hydrating history again', () => {
    const initial = deriveMessageEntryAnimation(
      createInitialMessageEntryAnimationState(),
      'conv_1',
      [entry('msg_1')]
    );
    const switched = deriveMessageEntryAnimation(initial.nextState, 'conv_2', [entry('old_1'), entry('old_2')]);

    expect([...switched.animatedItemIds]).toEqual([]);
    expect([...switched.nextState.seenItemIds]).toEqual(['old_1', 'old_2']);
  });
});

function entry(itemId: string, continuityKey = `message:${itemId}`): { itemId: string; continuityKey: string } {
  return { itemId, continuityKey };
}
