"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useCallback } from "react";

interface CardEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export function CardEditor({ content, onChange, placeholder }: CardEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Image,
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[100px] px-3 py-2 text-sm focus:outline-none prose prose-sm dark:prose-invert max-w-none",
      },
    },
  });

  const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("Image URL:");
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rounded-lg border border-foreground/15 overflow-hidden">
      <div className="flex gap-1 border-b border-foreground/10 px-2 py-1.5 bg-foreground/[0.03]">
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`rounded px-2 py-1 text-xs font-bold transition-colors ${
            editor.isActive("bold")
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
        >
          B
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`rounded px-2 py-1 text-xs italic transition-colors ${
            editor.isActive("italic")
              ? "bg-foreground/15 text-foreground"
              : "text-foreground/50 hover:text-foreground hover:bg-foreground/5"
          }`}
        >
          I
        </button>
        <button
          type="button"
          onClick={addImage}
          className="rounded px-2 py-1 text-xs text-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          IMG
        </button>
      </div>
      {placeholder && editor.isEmpty && (
        <div className="pointer-events-none absolute px-3 py-2 text-sm text-foreground/30">
          {placeholder}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
