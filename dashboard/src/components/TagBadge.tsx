interface TagBadgeProps {
  name: string;
  color?: string;
}

export default function TagBadge({ name, color }: TagBadgeProps) {
  return (
    <span
      className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50"
      style={color ? { borderColor: color + "50", color } : undefined}
    >
      {name}
    </span>
  );
}
