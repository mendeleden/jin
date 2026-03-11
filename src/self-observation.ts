/**
 * Self-observation filter: prevents jin from re-ingesting its own output files.
 *
 * The previous approach used a cwdSlug match which was too broad — it excluded
 * ALL Claude Code sessions in the same project directory as jin's cwd, even
 * though jin never writes to ~/.claude/projects/. This blocked legitimate
 * conversations from being indexed.
 *
 * The correct approach: only exclude paths that jin actually writes to
 * (log file, SQLite store, raw copies, benchmarks, pid file).
 */

export interface JinOutputPaths {
  logFile: string;  // e.g. ~/.config/jin/jin.log
  dbPath: string;   // e.g. ~/.config/jin/store.db
  rawDir: string;   // e.g. ~/.config/jin/raw
}

/**
 * Returns true if the given event path should be excluded because it's
 * a file that jin itself writes to (preventing feedback loops).
 */
export function shouldExcludeEvent(
  eventPath: string,
  jinPaths: JinOutputPaths
): boolean {
  // Exact match or prefix match on jin's config directory outputs
  const configDir = jinPaths.logFile.replace(/\/[^/]+$/, ""); // parent dir of log file

  // Exclude anything inside jin's config directory (log, db, raw, benchmarks, pid)
  if (eventPath.startsWith(configDir + "/")) {
    return true;
  }

  return false;
}
