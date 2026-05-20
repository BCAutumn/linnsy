import {
  getMarkdown,
  parseMarkdownToStructure,
  type MarkdownToken,
  type ParsedNode
} from 'stream-markdown-parser';

const chatMarkdown = getMarkdown('linnsy-chat-message');

function getTokenChildren(token: MarkdownToken): MarkdownToken[] {
  return Array.isArray(token.children) ? token.children : [];
}

function normalizeSoftBreaks(tokens: MarkdownToken[]): MarkdownToken[] {
  const stack: MarkdownToken[] = [...tokens];
  while (stack.length > 0) {
    const token = stack.pop();
    if (token === undefined) continue;
    if (token.type === 'softbreak') {
      token.type = 'hardbreak';
    }
    stack.push(...getTokenChildren(token));
  }
  return tokens;
}

export function parseChatMarkdown(content: string): ParsedNode[] {
  return parseMarkdownToStructure(content, chatMarkdown, {
    // AI 聊天里的单换行通常是作者有意换行，解析层转成 hardbreak，渲染层只负责画结构。
    preTransformTokens: normalizeSoftBreaks
  });
}
