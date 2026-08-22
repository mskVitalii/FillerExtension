import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface CoverLetterEditorProps {
  content: string;
  onChange: (plainText: string) => void;
  className?: string;
}

/** TipTap-backed cover letter editor (spec section 16) — fully user-editable generated text. */
export function CoverLetterEditor({ content, onChange, className }: CoverLetterEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: paragraphsToHtml(content),
    onUpdate: ({ editor }) => onChange(editor.getText({ blockSeparator: "\n\n" })),
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getText({ blockSeparator: "\n\n" });
    if (current !== content) {
      editor.commands.setContent(paragraphsToHtml(content));
    }
  }, [content, editor]);

  return (
    <div className={cn("rounded-md border border-border", className)}>
      <EditorContent editor={editor} />
    </div>
  );
}

function paragraphsToHtml(plainText: string): string {
  return plainText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
