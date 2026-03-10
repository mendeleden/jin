/**
 * Verify Postgres push results. Returns JSON with session/message counts and metadata.
 * Usage: bun run verify-postgres.ts <connectionString>
 */
const connString = process.argv[2];
if (!connString) {
  console.error("Usage: bun run verify-postgres.ts <connectionString>");
  process.exit(1);
}

const { SQL } = await import("bun");
const sql = new SQL(connString);

try {
  const [sessionRow] = await sql.unsafe("SELECT count(*) as cnt FROM public.jin_sessions");
  const [messageRow] = await sql.unsafe("SELECT count(*) as cnt FROM public.jin_messages");
  const [invalidRow] = await sql.unsafe(
    "SELECT count(*) as cnt FROM public.jin_messages WHERE role NOT IN ('user','assistant','system')",
  );

  const teamRows = await sql.unsafe("SELECT DISTINCT team_id FROM public.jin_sessions LIMIT 1");
  const devRows = await sql.unsafe("SELECT DISTINCT developer_id FROM public.jin_sessions LIMIT 1");

  const topSessions = await sql.unsafe(
    "SELECT id, adapter_id, name, message_count, team_id, developer_id FROM public.jin_sessions ORDER BY created_at DESC LIMIT 10",
  );

  const result = {
    sessions: Number(sessionRow.cnt),
    messages: Number(messageRow.cnt),
    invalidRoles: Number(invalidRow.cnt),
    teamId: teamRows.length > 0 ? teamRows[0].team_id : "",
    developerId: devRows.length > 0 ? devRows[0].developer_id : "",
    topSessions: topSessions.map((r: any) => ({
      adapter: r.adapter_id,
      name: (r.name || "").slice(0, 40),
      msgs: r.message_count,
      team: r.team_id,
      dev: r.developer_id,
    })),
  };

  console.log(JSON.stringify(result));
} finally {
  sql.close();
}
