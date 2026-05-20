import React, { useEffect, useMemo, useRef } from 'react';

import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from '@tiptap/markdown';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import type { FluentIconName } from './FluentIcon.js';
import { IconActionButtons } from './IconActionButtons.js';

export type TiptapMarkdownEditorMode = 'wysiwyg' | 'markdown';

export interface TiptapMarkdownEditorToolbarLabels {
  bold: string;
  bulletList: string;
  heading: string;
  italic: string;
  orderedList: string;
  quote: string;
}

type ToolbarCommand = 'bold' | 'bulletList' | 'heading' | 'italic' | 'orderedList' | 'quote';

const TOOLBAR_ITEMS: ReadonlyArray<{
  command: ToolbarCommand;
  icon: FluentIconName;
  labelKey: keyof TiptapMarkdownEditorToolbarLabels;
}> = [
  { command: 'bold', icon: 'textBold', labelKey: 'bold' },
  { command: 'italic', icon: 'textItalic', labelKey: 'italic' },
  { command: 'heading', icon: 'textHeader2', labelKey: 'heading' },
  { command: 'bulletList', icon: 'textBulletList', labelKey: 'bulletList' },
  { command: 'orderedList', icon: 'textNumberList', labelKey: 'orderedList' },
  { command: 'quote', icon: 'textQuote', labelKey: 'quote' }
];

export function TiptapMarkdownEditor(props: {
  ariaLabel: string;
  mode: TiptapMarkdownEditorMode;
  placeholder: string;
  toolbarLabels: TiptapMarkdownEditorToolbarLabels;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const syncingRef = useRef(false);
  const onChangeRef = useRef(props.onChange);
  const extensions = useMemo(() => [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      horizontalRule: false,
      link: false,
      strike: false,
      underline: false
    }),
    Placeholder.configure({
      placeholder: props.placeholder
    }),
    Markdown.configure({
      markedOptions: { gfm: true }
    })
  ], [props.placeholder]);

  useEffect(() => {
    onChangeRef.current = props.onChange;
  }, [props.onChange]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: props.value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        'aria-label': props.ariaLabel,
        class: 'memory-tiptap-prosemirror'
      }
    },
    onUpdate: ({ editor: nextEditor }) => {
      if (syncingRef.current) return;
      onChangeRef.current(nextEditor.getMarkdown());
    }
  });

  useEffect(() => {
    if (editor === null) return;
    const currentMarkdown = editor.getMarkdown();
    if (currentMarkdown === props.value) return;

    syncingRef.current = true;
    editor.commands.setContent(props.value, {
      contentType: 'markdown',
      emitUpdate: false
    });
    syncingRef.current = false;
  }, [editor, props.value]);

  const shellClassName = props.mode === 'wysiwyg'
    ? 'memory-tiptap-editor-shell memory-tiptap-editor-shell--toolbar'
    : 'memory-tiptap-editor-shell';

  return (
    <div className={shellClassName}>
      {props.mode === 'wysiwyg' ? (
        <IconActionButtons
          ariaLabel={props.ariaLabel}
          items={TOOLBAR_ITEMS.map((item) => ({
            value: item.command,
            label: props.toolbarLabels[item.labelKey],
            icon: item.icon
          }))}
          onAction={(command) => {
            executeToolbarCommand(editor, command);
          }}
          size="md"
        />
      ) : null}
      {props.mode === 'wysiwyg' ? (
        <EditorContent className="scroll-area memory-tiptap-editor-host" editor={editor} />
      ) : (
        <textarea
          aria-label={props.ariaLabel}
          className="scroll-area memory-tiptap-source-editor"
          onChange={(event) => {
            props.onChange(event.currentTarget.value);
          }}
          placeholder={props.placeholder}
          value={props.value}
        />
      )}
    </div>
  );
}

function executeToolbarCommand(editor: Editor | null, command: ToolbarCommand): void {
  if (editor === null) return;

  const chain = editor.chain().focus();
  switch (command) {
    case 'bold':
      chain.toggleBold().run();
      return;
    case 'italic':
      chain.toggleItalic().run();
      return;
    case 'heading':
      chain.toggleHeading({ level: 2 }).run();
      return;
    case 'bulletList':
      chain.toggleBulletList().run();
      return;
    case 'orderedList':
      chain.toggleOrderedList().run();
      return;
    case 'quote':
      chain.toggleBlockquote().run();
  }
}
