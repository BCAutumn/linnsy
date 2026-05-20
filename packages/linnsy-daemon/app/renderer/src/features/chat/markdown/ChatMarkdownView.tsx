import React, { useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import type {
  AdmonitionNode,
  BlockquoteNode,
  CodeBlockNode,
  DefinitionItemNode,
  DefinitionListNode,
  HeadingNode,
  HtmlBlockNode,
  HtmlInlineNode,
  ImageNode,
  InlineCodeNode,
  LinkNode,
  ListItemNode,
  ListNode,
  MathBlockNode,
  MathInlineNode,
  ParsedNode,
  ParagraphNode,
  ReferenceNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  TextNode
} from 'stream-markdown-parser';

import { parseChatMarkdown } from './chat-markdown.js';
import {
  parseChatMarkdownWithCache,
  type ChatMarkdownCache
} from './chat-markdown-cache.js';

interface ChatMarkdownViewProps {
  content: string;
  streaming?: boolean;
  showStreamingCursor?: boolean;
}

// 光标只是一层渲染装饰：沿 AST 一直递给最后一个叶子节点，避免出现在段落下一行。
function renderChildren(children: ParsedNode[], keyPrefix: string, appendCursor = false): ReactNode[] {
  if (children.length === 0) {
    return appendCursor ? [renderStreamingCursor(`${keyPrefix}-cursor`)] : [];
  }
  const lastIndex = children.length - 1;
  return children.map((child, index) => renderNode(
    child,
    `${keyPrefix}-${String(index)}`,
    appendCursor && index === lastIndex
  ));
}

function isNodeType<TNode extends ParsedNode>(
  node: ParsedNode,
  type: TNode['type']
): node is TNode {
  return node.type === type;
}

function normalizeExternalHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('mailto:')) {
    return trimmed;
  }
  return null;
}

function normalizeImageSrc(src: string): string | null {
  const trimmed = src.trim();
  if (trimmed.startsWith('https://') || trimmed.startsWith('data:')) {
    return trimmed;
  }
  return null;
}

function renderText(node: TextNode): string {
  return node.content;
}

function renderStreamingCursor(key: string): ReactElement {
  return <span aria-hidden="true" className="linnsy-markdown__streaming-cursor" key={key} />;
}

function renderTextWithOptionalCursor(node: TextNode, key: string, appendCursor: boolean): ReactNode {
  if (!appendCursor) return renderText(node);
  return (
    <React.Fragment key={key}>
      {renderText(node)}
      {renderStreamingCursor(`${key}-cursor`)}
    </React.Fragment>
  );
}

function renderParagraph(node: ParagraphNode, key: string, appendCursor: boolean): ReactElement {
  return <p key={key}>{renderChildren(node.children, key, appendCursor)}</p>;
}

function renderHeading(node: HeadingNode, key: string, appendCursor: boolean): ReactElement {
  const level = Math.min(Math.max(node.level, 1), 4);
  const headingTags = ['h1', 'h2', 'h3', 'h4'] as const;
  const HeadingTag = headingTags[level - 1] ?? 'h4';
  return <HeadingTag key={key}>{renderChildren(node.children, key, appendCursor)}</HeadingTag>;
}

function renderBlockquote(node: BlockquoteNode, key: string, appendCursor: boolean): ReactElement {
  return <blockquote key={key}>{renderChildren(node.children, key, appendCursor)}</blockquote>;
}

function renderList(node: ListNode, key: string, appendCursor: boolean): ReactElement {
  const lastIndex = node.items.length - 1;
  const items = node.items.map((item, index) => renderNode(
    item,
    `${key}-item-${String(index)}`,
    appendCursor && index === lastIndex
  ));
  if (node.ordered) {
    return <ol key={key} start={node.start}>{items}</ol>;
  }
  return <ul key={key}>{items}</ul>;
}

function renderListItem(node: ListItemNode, key: string, appendCursor: boolean): ReactElement {
  return <li key={key}>{renderChildren(node.children, key, appendCursor)}</li>;
}

function renderCodeBlock(node: CodeBlockNode, key: string, appendCursor: boolean): ReactElement {
  const language = node.language.trim();
  return (
    <pre className="md-code-block" key={key}>
      <code data-language={language || undefined}>
        {node.code}
        {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
      </code>
    </pre>
  );
}

function renderInlineCode(node: InlineCodeNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <code key={key}>
      {node.code}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </code>
  );
}

function renderLink(node: LinkNode, key: string, appendCursor: boolean): ReactElement {
  const href = normalizeExternalHref(node.href);
  if (href === null) {
    return <span key={key}>{renderChildren(node.children, key, appendCursor)}</span>;
  }
  return (
    <a href={href} key={key} rel="noreferrer noopener" target="_blank" title={node.title ?? undefined}>
      {renderChildren(node.children, key, appendCursor)}
    </a>
  );
}

function renderImage(node: ImageNode, key: string, appendCursor: boolean): ReactElement | null {
  const src = normalizeImageSrc(node.src);
  if (src === null) return null;
  const image = <img alt={node.alt} className="md-image" src={src} title={node.title ?? undefined} />;
  if (!appendCursor) return <React.Fragment key={key}>{image}</React.Fragment>;
  return (
    <React.Fragment key={key}>
      {image}
      {renderStreamingCursor(`${key}-cursor`)}
    </React.Fragment>
  );
}

function renderTable(node: TableNode, key: string, appendCursor: boolean): ReactElement {
  const lastRowIndex = node.rows.length - 1;
  return (
    <table key={key}>
      <thead>{renderNode(node.header, `${key}-header`)}</thead>
      <tbody>{node.rows.map((row, index) => renderNode(
        row,
        `${key}-row-${String(index)}`,
        appendCursor && index === lastRowIndex
      ))}</tbody>
    </table>
  );
}

function renderTableRow(node: TableRowNode, key: string, appendCursor: boolean): ReactElement {
  const lastIndex = node.cells.length - 1;
  return (
    <tr key={key}>
      {node.cells.map((cell, index) => renderNode(
        cell,
        `${key}-cell-${String(index)}`,
        appendCursor && index === lastIndex
      ))}
    </tr>
  );
}

function renderTableCell(node: TableCellNode, key: string, appendCursor: boolean): ReactElement {
  const CellTag = node.header ? 'th' : 'td';
  return (
    <CellTag key={key} style={node.align === undefined ? undefined : { textAlign: node.align }}>
      {renderChildren(node.children, key, appendCursor)}
    </CellTag>
  );
}

function renderDefinitionList(node: DefinitionListNode, key: string, appendCursor: boolean): ReactElement {
  const lastIndex = node.items.length - 1;
  return (
    <dl key={key}>
      {node.items.map((item, index) => renderNode(
        item,
        `${key}-item-${String(index)}`,
        appendCursor && index === lastIndex
      ))}
    </dl>
  );
}

function renderDefinitionItem(node: DefinitionItemNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <React.Fragment key={key}>
      <dt>{renderChildren(node.term, `${key}-term`)}</dt>
      <dd>{renderChildren(node.definition, `${key}-definition`, appendCursor)}</dd>
    </React.Fragment>
  );
}

function renderAdmonition(node: AdmonitionNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <aside className={`md-admonition md-admonition-${node.kind}`} key={key}>
      {node.title ? <strong>{node.title}</strong> : null}
      {renderChildren(node.children, key, appendCursor)}
    </aside>
  );
}

function renderMathInline(node: MathInlineNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <code className="md-math-inline" key={key}>
      {node.content}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </code>
  );
}

function renderMathBlock(node: MathBlockNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <pre className="md-math-block" key={key}>
      {node.content}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </pre>
  );
}

function renderReference(node: ReferenceNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <span className="md-reference" key={key}>
      {node.raw}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </span>
  );
}

function renderHtmlInline(node: HtmlInlineNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <span key={key}>
      {node.content}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </span>
  );
}

function renderHtmlBlock(node: HtmlBlockNode, key: string, appendCursor: boolean): ReactElement {
  return (
    <div key={key}>
      {node.content}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </div>
  );
}

function renderNode(node: ParsedNode, key: string, appendCursor = false): ReactNode {
  if (isNodeType<TextNode>(node, 'text')) return renderTextWithOptionalCursor(node, key, appendCursor);
  if (isNodeType<ParagraphNode>(node, 'paragraph')) return renderParagraph(node, key, appendCursor);
  if (isNodeType<HeadingNode>(node, 'heading')) return renderHeading(node, key, appendCursor);
  if (isNodeType<BlockquoteNode>(node, 'blockquote')) return renderBlockquote(node, key, appendCursor);
  if (isNodeType<ListNode>(node, 'list')) return renderList(node, key, appendCursor);
  if (isNodeType<ListItemNode>(node, 'list_item')) return renderListItem(node, key, appendCursor);
  if (isNodeType<CodeBlockNode>(node, 'code_block')) return renderCodeBlock(node, key, appendCursor);
  if (isNodeType<InlineCodeNode>(node, 'inline_code')) return renderInlineCode(node, key, appendCursor);
  if (isNodeType<LinkNode>(node, 'link')) return renderLink(node, key, appendCursor);
  if (isNodeType<ImageNode>(node, 'image')) return renderImage(node, key, appendCursor);
  if (isNodeType<TableNode>(node, 'table')) return renderTable(node, key, appendCursor);
  if (isNodeType<TableRowNode>(node, 'table_row')) return renderTableRow(node, key, appendCursor);
  if (isNodeType<TableCellNode>(node, 'table_cell')) return renderTableCell(node, key, appendCursor);
  if (isNodeType<DefinitionListNode>(node, 'definition_list')) return renderDefinitionList(node, key, appendCursor);
  if (isNodeType<DefinitionItemNode>(node, 'definition_item')) return renderDefinitionItem(node, key, appendCursor);
  if (isNodeType<AdmonitionNode>(node, 'admonition')) return renderAdmonition(node, key, appendCursor);
  if (isNodeType<MathInlineNode>(node, 'math_inline')) return renderMathInline(node, key, appendCursor);
  if (isNodeType<MathBlockNode>(node, 'math_block')) return renderMathBlock(node, key, appendCursor);
  if (isNodeType<ReferenceNode>(node, 'reference')) return renderReference(node, key, appendCursor);
  if (isNodeType<HtmlInlineNode>(node, 'html_inline')) return renderHtmlInline(node, key, appendCursor);
  if (isNodeType<HtmlBlockNode>(node, 'html_block')) return renderHtmlBlock(node, key, appendCursor);
  if (node.type === 'thematic_break') {
    return <div aria-hidden="true" className="linnsy-markdown-separator" key={key} />;
  }
  if (node.type === 'hardbreak') return <br key={key} />;
  if (isNodeType<Extract<ParsedNode, { type: 'strong' }>>(node, 'strong')) {
    return <strong key={key}>{renderChildren(node.children, key, appendCursor)}</strong>;
  }
  if (isNodeType<Extract<ParsedNode, { type: 'emphasis' }>>(node, 'emphasis')) {
    return <em key={key}>{renderChildren(node.children, key, appendCursor)}</em>;
  }
  if (isNodeType<Extract<ParsedNode, { type: 'strikethrough' }>>(node, 'strikethrough')) {
    return <s key={key}>{renderChildren(node.children, key, appendCursor)}</s>;
  }
  if (isNodeType<Extract<ParsedNode, { type: 'highlight' }>>(node, 'highlight')) {
    return <mark key={key}>{renderChildren(node.children, key, appendCursor)}</mark>;
  }
  if (isNodeType<Extract<ParsedNode, { type: 'insert' }>>(node, 'insert')) {
    return <ins key={key}>{renderChildren(node.children, key, appendCursor)}</ins>;
  }
  if (isNodeType<Extract<ParsedNode, { type: 'subscript' }>>(node, 'subscript')) {
    return <sub key={key}>{renderChildren(node.children, key, appendCursor)}</sub>;
  }
  if (isNodeType<Extract<ParsedNode, { type: 'superscript' }>>(node, 'superscript')) {
    return <sup key={key}>{renderChildren(node.children, key, appendCursor)}</sup>;
  }
  if (
    isNodeType<Extract<ParsedNode, { type: 'checkbox' }>>(node, 'checkbox')
    || isNodeType<Extract<ParsedNode, { type: 'checkbox_input' }>>(node, 'checkbox_input')
  ) {
    return (
      <React.Fragment key={key}>
        <input aria-checked={node.checked} checked={node.checked} disabled readOnly type="checkbox" />
        {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
      </React.Fragment>
    );
  }
  if (isNodeType<Extract<ParsedNode, { type: 'emoji' }>>(node, 'emoji')) {
    return (
      <span key={key}>
        {node.markup}
        {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
      </span>
    );
  }
  return (
    <span key={key}>
      {node.raw}
      {appendCursor ? renderStreamingCursor(`${key}-cursor`) : null}
    </span>
  );
}

export function ChatMarkdownView({
  content,
  streaming = false,
  showStreamingCursor = false
}: ChatMarkdownViewProps): ReactElement {
  const cacheRef = useRef<ChatMarkdownCache | null>(null);
  const nodes = useMemo(() => {
    if (!streaming) {
      cacheRef.current = null;
      return parseChatMarkdown(content);
    }
    const result = parseChatMarkdownWithCache(content, cacheRef.current);
    cacheRef.current = result.cache;
    return result.nodes;
  }, [content, streaming]);
  const lastNodeIndex = nodes.length - 1;
  return (
    <div className="linnsy-markdown" data-streaming={streaming ? 'true' : 'false'}>
      {nodes.length === 0 && showStreamingCursor ? renderStreamingCursor('node-cursor') : null}
      {nodes.map((node, index) => renderNode(
        node,
        `node-${String(index)}`,
        showStreamingCursor && index === lastNodeIndex
      ))}
    </div>
  );
}
