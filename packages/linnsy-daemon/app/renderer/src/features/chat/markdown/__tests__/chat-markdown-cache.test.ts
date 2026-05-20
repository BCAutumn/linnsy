import { describe, expect, test } from 'vitest';

import { parseChatMarkdown } from '../chat-markdown.js';
import {
  parseChatMarkdownWithCache,
  splitStableMarkdownBlocks,
  type ChatMarkdownCache
} from '../chat-markdown-cache.js';

describe('chat markdown streaming cache', () => {
  test('reuses stable block nodes while reparsing only the growing tail', () => {
    const first = parseChatMarkdownWithCache('第一段 **稳定**。\n\n第二', null);
    expect(first.cache?.blocks).toHaveLength(1);
    const cachedFirstBlock = first.cache?.blocks[0];

    const second = parseChatMarkdownWithCache('第一段 **稳定**。\n\n第二段继续增长', first.cache);

    expect(second.cache?.blocks[0]).toBe(cachedFirstBlock);
    expect(second.nodes).toEqual(parseChatMarkdown('第一段 **稳定**。\n\n第二段继续增长'));
  });

  test('does not split blank lines inside an unclosed fenced code block', () => {
    const split = splitStableMarkdownBlocks([
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;'
    ].join('\n'));

    expect(split.stableBlocks).toEqual([]);
    expect(split.tail).toContain('const b = 2;');
  });

  test('turns a closed fenced code block into a reusable stable block', () => {
    const content = [
      '```ts',
      'const a = 1;',
      '',
      'const b = 2;',
      '```',
      '',
      '后续段落'
    ].join('\n');
    const split = splitStableMarkdownBlocks(content);

    expect(split.stableBlocks).toHaveLength(1);
    expect(split.stableBlocks[0]).toContain('const b = 2;');
    expect(split.tail).toBe('后续段落');
  });

  test('does not treat an indented code block marker as a fenced block opener', () => {
    const content = [
      '    ```ts',
      '',
      '后续段落'
    ].join('\n');
    const split = splitStableMarkdownBlocks(content);

    expect(split.stableBlocks).toHaveLength(1);
    expect(split.tail).toBe('后续段落');
  });

  test('keeps list containers in the tail when they can continue across a blank line', () => {
    const content = [
      '- 第一项',
      '',
      '  续写第一项'
    ].join('\n');
    const split = splitStableMarkdownBlocks(content);

    expect(split.stableBlocks).toEqual([]);
    expect(split.tail).toBe(content);
  });

  test('falls back to full parse when a reference definition can affect earlier links', () => {
    const result = parseChatMarkdownWithCache('[文档][docs]\n\n[docs]: https://example.com', null);

    expect(result.cache).toBeNull();
    expect(result.nodes).toEqual(parseChatMarkdown('[文档][docs]\n\n[docs]: https://example.com'));
  });

  test('matches full parse across many arbitrary stream chunks', () => {
    let cache: ChatMarkdownCache | null = null;
    let content = '';
    for (const chunk of splitIntoChunks(createLongMarkdown(), 37)) {
      content += chunk;
      const result = parseChatMarkdownWithCache(content, cache);
      cache = result.cache;
      expect(result.nodes).toEqual(parseChatMarkdown(content));
    }
  });
});

function createLongMarkdown(): string {
  const sections: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    sections.push([
      `### 第 ${String(index + 1)} 段`,
      '',
      `这是一段 **markdown**，带 [链接](https://example.com/${String(index)})。`,
      '',
      `- 第一项 ${String(index)}`,
      `- 第二项 ${String(index)}`,
      '',
      '```ts',
      `const value${String(index)} = ${String(index)};`,
      '',
      `console.log(value${String(index)});`,
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
