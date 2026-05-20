import { calculateMessageListClipBottom } from '../chat-scroll-clip.js';

describe('chat scroll clip', () => {
  it('clips the message layer where the sticky composer covers the viewport', () => {
    expect(calculateMessageListClipBottom({
      clientHeight: 800,
      clipEntryDepth: 0,
      composerHeight: 120,
      messageListHeight: 2000,
      scrollTop: 500
    })).toBe(820);
  });

  it('moves the clip boundary into the composer surface', () => {
    expect(calculateMessageListClipBottom({
      clientHeight: 800,
      clipEntryDepth: 10,
      composerHeight: 120,
      messageListHeight: 2000,
      scrollTop: 500
    })).toBe(810);
  });

  it('does not clip once the normal composer flow is reached at the bottom', () => {
    expect(calculateMessageListClipBottom({
      clientHeight: 800,
      clipEntryDepth: 10,
      composerHeight: 120,
      messageListHeight: 2000,
      scrollTop: 1320
    })).toBe(0);
  });

  it('keeps short conversations uncut', () => {
    expect(calculateMessageListClipBottom({
      clientHeight: 800,
      clipEntryDepth: 10,
      composerHeight: 120,
      messageListHeight: 520,
      scrollTop: 0
    })).toBe(0);
  });
});
