export function formatProjectReference(value?: string | null): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "local / unlinked";
  }

  const githubSshMatch = /^git@github\.com:(.+)$/i.exec(trimmed);
  if (githubSshMatch?.[1]) {
    return githubSshMatch[1];
  }

  const githubSshUrlMatch = /^ssh:\/\/git@github\.com\/(.+)$/i.exec(trimmed);
  if (githubSshUrlMatch?.[1]) {
    return githubSshUrlMatch[1];
  }

  return trimmed
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^(?:www\.)?github\.com\//i, "");
}
