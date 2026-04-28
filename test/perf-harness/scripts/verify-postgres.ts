/**
 * Verify Postgres push results. Returns JSON with conversation/message counts and metadata.
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
  const [conversationRow] = await sql.unsafe("SELECT count(*) as cnt FROM public.jin_conversations");
  const [messageRow] = await sql.unsafe("SELECT count(*) as cnt FROM public.jin_messages");
  const [invalidRow] = await sql.unsafe(
    "SELECT count(*) as cnt FROM public.jin_messages WHERE role NOT IN ('user','assistant','system')",
  );

  const teamRows = await sql.unsafe("SELECT DISTINCT team_id FROM public.jin_conversations LIMIT 1");
  const userRows = await sql.unsafe("SELECT DISTINCT user_id FROM public.jin_conversations LIMIT 1");

  const topConversations = await sql.unsafe(
    "SELECT id, adapter_id, name, message_count, team_id, user_id FROM public.jin_conversations ORDER BY started_at DESC LIMIT 10",
  );

  const result = {
    conversations: Number(conversationRow.cnt),
    messages: Number(messageRow.cnt),
    invalidRoles: Number(invalidRow.cnt),
    teamId: teamRows.length > 0 ? teamRows[0].team_id : "",
    userId: userRows.length > 0 ? userRows[0].user_id : "",
    topConversations: topConversations.map((r: any) => ({
      adapter: r.adapter_id,
      name: (r.name || "").slice(0, 40),
      msgs: r.message_count,
      team: r.team_id,
      user: r.user_id,
    })),
  };

  console.log(JSON.stringify(result));
} finally {
  sql.close();
}
