import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";

// Every click on a link, with any modifier or button, stays in the app (handleClickOn misses some).
function stayOnLinks(_view: unknown, event: MouseEvent) {
  if ((event.target as HTMLElement).closest("a")) event.preventDefault();
  return false;
}

/** Markdown-backed rich text editor used for both "My notes" and "Enhanced notes". */
export function Editor({ value, onChange, placeholder, onTimestamp, autoFocus, className = "", docKey }: {
  value: string;
  onChange: (md: string) => void;
  placeholder?: string;
  onTimestamp?: (ms: number) => void;
  autoFocus?: boolean;
  className?: string;
  /** Changing this resets the content (e.g. switching meetings or note versions). */
  docKey: string;
}) {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }), // Link is configured below, once
        Placeholder.configure({ placeholder: placeholder ?? "Write notes…" }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Link.configure({ openOnClick: false, autolink: false }),
        Markdown.configure({ html: false, transformPastedText: true, linkify: false }),
      ],
      content: value,
      autofocus: autoFocus ? "end" : false,
      onUpdate: ({ editor }) => {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          latest.current((editor.storage as any).markdown.getMarkdown());
        }, 400);
      },
      editorProps: {
        handleDOMEvents: { click: stayOnLinks, auxclick: stayOnLinks },
        handleClickOn: (_view, _pos, node, _np, event) => {
          const a = (event.target as HTMLElement).closest("a");
          if (!a) return false;
          const href = a.getAttribute("href") ?? "";
          const m = href.match(/^#t=(\d+)/);
          if (m && onTimestamp) {
            event.preventDefault();
            onTimestamp(Number(m[1]));
            return true;
          }
          void node;
          event.preventDefault();
          return true; // never navigate the webview to external links
        },
      },
    },
    [docKey],
  );

  // Flush pending edits when leaving.
  useEffect(
    () => () => {
      if (timer.current !== undefined && editor) {
        window.clearTimeout(timer.current);
        try {
          latest.current((editor.storage as any).markdown.getMarkdown());
        } catch {
          /* editor already destroyed */
        }
      }
    },
    [editor],
  );

  return <EditorContent editor={editor} className={`selectable ${className}`} />;
}
