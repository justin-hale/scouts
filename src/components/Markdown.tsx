import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders event descriptions. GFM gives us auto-linking of bare URLs plus
 * markdown links/lists. Links open in a new tab.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
