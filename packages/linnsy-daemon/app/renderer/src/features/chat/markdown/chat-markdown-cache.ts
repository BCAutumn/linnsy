import type { ParsedNode } from 'stream-markdown-parser';

import { parseChatMarkdown } from './chat-markdown.js';

export interface ChatMarkdownCacheBlock {
  source: string;
  nodes: readonly ParsedNode[];
}

export interface ChatMarkdownCache {
  content: string;
  blocks: readonly ChatMarkdownCacheBlock[];
  tailSource: string;
  tailNodes: readonly ParsedNode[];
  nodes: readonly ParsedNode[];
}

export interface ChatMarkdownParseResult {
  nodes: readonly ParsedNode[];
  cache: ChatMarkdownCache | null;
}

interface SplitStableBlocksResult {
  stableBlocks: readonly string[];
  tail: string;
}

// Reference / footnote definitions can change how earlier reference links resolve.
// 遇到这类全局语法时宁可全量解析，避免为了性能改变最终语义。
const referenceDefinitionPattern = /(?:^|\n)[ \t]{0,3}\[[^\]\n]+\]:/;

export function parseChatMarkdownWithCache(
  content: string,
  previous: ChatMarkdownCache | null
): ChatMarkdownParseResult {
  if (content.length === 0) {
    return createCachedResult('', [], '');
  }
  if (shouldForceFullParse(content)) {
    return {
      nodes: parseChatMarkdown(content),
      cache: null
    };
  }

  const split = splitStableMarkdownBlocks(content);
  const blocks = split.stableBlocks.map((source, index): ChatMarkdownCacheBlock => {
    const cached = previous?.blocks[index];
    if (cached !== undefined && cached.source === source) {
      return cached;
    }
    return {
      source,
      nodes: parseChatMarkdown(source)
    };
  });
  const tailNodes = split.tail.length === 0 ? [] : parseChatMarkdown(split.tail);
  return createCachedResult(content, blocks, split.tail, tailNodes);
}

export function splitStableMarkdownBlocks(content: string): SplitStableBlocksResult {
  if (content.length === 0) {
    return { stableBlocks: [], tail: '' };
  }

  const boundaries = findStableBoundaryOffsets(content);
  if (boundaries.length === 0) {
    return { stableBlocks: [], tail: content };
  }

  const stableBlocks: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    stableBlocks.push(content.slice(start, boundary));
    start = boundary;
  }
  return {
    stableBlocks,
    tail: content.slice(start)
  };
}

function createCachedResult(
  content: string,
  blocks: readonly ChatMarkdownCacheBlock[],
  tailSource: string,
  tailNodes: readonly ParsedNode[] = []
): ChatMarkdownParseResult {
  const nodes = blocks.flatMap((block) => block.nodes).concat(tailNodes);
  return {
    nodes,
    cache: {
      content,
      blocks,
      tailSource,
      tailNodes,
      nodes
    }
  };
}

function shouldForceFullParse(content: string): boolean {
  return referenceDefinitionPattern.test(content);
}

function findStableBoundaryOffsets(content: string): number[] {
  const boundaries: number[] = [];
  const lines = content.split('\n');
  let offset = 0;
  let inFence: { marker: '`' | '~'; length: number } | null = null;
  let previousLineBlank = false;
  let previousNonBlankLine = '';

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const hasLineBreak = lineIndex < lines.length - 1;
    const lineWithBreakLength = line.length + (hasLineBreak ? 1 : 0);
    const fence = readFenceMarker(line);
    if (fence !== null) {
      if (inFence === null) {
        inFence = fence;
      } else if (fence.marker === inFence.marker && fence.length >= inFence.length) {
        inFence = null;
      }
    }

    const isBlank = line.trim().length === 0;
    const boundary = offset + lineWithBreakLength;
    const nextLine = lines[lineIndex + 1] ?? '';
    if (
      inFence === null
      && isBlank
      && !previousLineBlank
      && boundary < content.length
      && !isContainerBoundaryRisk(previousNonBlankLine, nextLine)
    ) {
      boundaries.push(boundary);
    }
    if (!isBlank) {
      previousNonBlankLine = line;
    }
    previousLineBlank = inFence === null && isBlank;
    offset += lineWithBreakLength;
  }

  return boundaries.filter((boundary) => boundary > 0 && boundary <= content.length);
}

function isContainerBoundaryRisk(previousNonBlankLine: string, nextLine: string): boolean {
  if (previousNonBlankLine.length === 0) {
    return false;
  }
  return isMarkdownContainerLine(previousNonBlankLine) || isMarkdownContainerLine(nextLine) || startsIndented(nextLine);
}

function isMarkdownContainerLine(line: string): boolean {
  const trimmedStart = line.replace(/^[ \t]{0,3}/, '');
  return trimmedStart.startsWith('>') || /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.test(trimmedStart);
}

function startsIndented(line: string): boolean {
  return /^(?: {2,}|\t)/.test(line);
}

function readFenceMarker(line: string): { marker: '`' | '~'; length: number } | null {
  let index = 0;
  let indent = 0;
  while (index < line.length && indent < 4) {
    const char = line[index];
    if (char === ' ') {
      index += 1;
      indent += 1;
      continue;
    }
    if (char === '\t') {
      index += 1;
      indent = 4;
      continue;
    }
    break;
  }

  if (indent >= 4) {
    return null;
  }
  const marker = line[index];
  if (marker !== '`' && marker !== '~') {
    return null;
  }
  let end = index;
  while (line[end] === marker) {
    end += 1;
  }
  const length = end - index;
  return length >= 3 ? { marker, length } : null;
}
