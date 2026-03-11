/**
 * Extract a field from JSON on stdin.
 * Usage: echo '{"foo":42}' | bun run json-field.ts foo
 * Supports dot notation: echo '{"a":{"b":1}}' | bun run json-field.ts a.b
 */
const field = process.argv[2];
if (!field) {
  console.error("Usage: echo '{...}' | bun run json-field.ts <field.path>");
  process.exit(1);
}

const input = await Bun.stdin.text();
const data = JSON.parse(input);

let value = data;
for (const key of field.split(".")) {
  value = value?.[key];
}

console.log(typeof value === "object" ? JSON.stringify(value) : String(value ?? ""));
