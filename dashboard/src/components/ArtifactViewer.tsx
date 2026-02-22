interface ArtifactViewerProps {
  content: string;
  kind: string;
  name: string;
}

export default function ArtifactViewer({ content, kind, name }: ArtifactViewerProps) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-800/30">
        <span className="text-xs font-mono text-zinc-400">{kind}</span>
        <span className="text-xs text-zinc-500">·</span>
        <span className="text-xs text-zinc-300 truncate">{name}</span>
      </div>
      <pre className="p-4 text-xs text-zinc-300 overflow-auto max-h-[500px] whitespace-pre-wrap break-words leading-relaxed font-mono">
        {content || "(empty)"}
      </pre>
    </div>
  );
}
