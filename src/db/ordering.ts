import type { ParsedMessage, ParsedToolCall } from "../contracts/conversations";

export const STAGED_MESSAGE_COPY_ORDER_BY = "sequence ASC, message_id ASC";
export const STAGED_TOOL_CALL_COPY_ORDER_BY = "message_id ASC, id ASC";

export function orderedMessages(
  messages: ReadonlyArray<ParsedMessage>,
): ParsedMessage[] {
  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index - 1].sequence > messages[index].sequence) {
      return [...messages].sort((left, right) => left.sequence - right.sequence);
    }
  }

  return messages as ParsedMessage[];
}

export function orderedToolCalls(
  toolCalls: ReadonlyArray<ParsedToolCall>,
): ParsedToolCall[] {
  for (let index = 1; index < toolCalls.length; index += 1) {
    if (toolCalls[index - 1].id.localeCompare(toolCalls[index].id) > 0) {
      return [...toolCalls].sort((left, right) => left.id.localeCompare(right.id));
    }
  }

  return toolCalls as ParsedToolCall[];
}
