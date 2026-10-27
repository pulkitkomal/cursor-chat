import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const html = DOMPurify.sanitize(marked.parse(text || "", { async: false }) as string);
  return (
    <div
      className={`md${streaming ? " streaming" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
