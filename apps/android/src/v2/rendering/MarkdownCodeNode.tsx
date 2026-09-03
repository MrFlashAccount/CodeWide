import type { RootContent } from "mdast";

import { CodeBlock } from "./CodeBlock";
import { AsciiDiagram, MermaidDiagram } from "./Diagram";
import { diagramRevision, looksLikeAsciiDiagram } from "./diagramModel";
import { RichExtensionCard } from "./RichExtensionCard";
import type { RichExtensionRenderer } from "./richExtensionRenderer";

interface MarkdownCodeNodeProps {
  extensions: Record<string, RichExtensionRenderer>;
  node: Extract<RootContent, { type: "code" }>;
  path: string;
  reviewTargetId?: string;
}

/** Selects the specialized V2 renderer for one fenced Markdown block. */
export function MarkdownCodeNode(props: MarkdownCodeNodeProps): React.JSX.Element {
  const { extensions, node, path, reviewTargetId } = props;
  const language = node.lang ?? "text";
  if (language.toLocaleLowerCase() === "mermaid") {
    return (
      <MermaidDiagram
        key={diagramRevision(node.value)}
        diagramId={path}
        source={node.value}
        {...(reviewTargetId === undefined ? {} : { reviewTargetId })}
      />
    );
  }
  if (looksLikeAsciiDiagram(node.value, node.lang)) {
    return <AsciiDiagram key={diagramRevision(node.value)} source={node.value} />;
  }
  if (language.startsWith("codex-")) {
    const extensionName = language.slice("codex-".length);
    const extension = extensions[extensionName];
    return extension === undefined ? (
      <RichExtensionCard kind={extensionName} meta={node.meta ?? null} value={node.value} />
    ) : (
      <>{extension(node.value, node.meta ?? null)}</>
    );
  }
  return <CodeBlock language={language} value={node.value} />;
}
