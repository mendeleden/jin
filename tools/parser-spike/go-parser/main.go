// Spike: Go-based Claude Code JSONL parser. Emits ConversationBundle JSON
// matching the TS adapter's shape closely enough to compare counts and totals.
//
// Scope (v0):
//   - parses user/assistant/system records
//   - walks parentUuid for parent_message_id
//   - increments turn on each user record
//   - splits into segments at system/compact_boundary
//   - extracts tool_use blocks → ToolCall, matches tool_result by tool_use_id
//   - sums usage tokens
// Out of scope (correctness work, not perf):
//   - SHA256 deterministic IDs (uses raw uuid/sessionId)
//   - sub-agent resolution
//   - git remote lookup
//   - thinking-block extraction (rare in target corpus)
package main

import (
	"bufio"
	"bytes"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

// --- contract types (match src/contracts/conversations.ts) ---

type ParsedToolCall struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Input      string `json:"input"`
	Output     string `json:"output"`
	IsError    bool   `json:"isError"`
	DurationMs int    `json:"durationMs"`
	Timestamp  string `json:"timestamp"`
}

type ParsedMessage struct {
	ID              string           `json:"id"`
	Role            string           `json:"role"`
	Content         string           `json:"content"`
	RecordType      string           `json:"recordType"`
	Model           string           `json:"model"`
	Sequence        int              `json:"sequence"`
	Turn            int              `json:"turn"`
	IsSidechain    bool             `json:"isSidechain"`
	ParentMessageID string           `json:"parentMessageId"`
	InputTokens     int              `json:"inputTokens"`
	OutputTokens    int              `json:"outputTokens"`
	CacheRead       int              `json:"cacheRead"`
	CacheWrite      int              `json:"cacheWrite"`
	ThinkingContent string           `json:"thinkingContent"`
	ThinkingTokens  int              `json:"thinkingTokens"`
	Timestamp       string           `json:"timestamp"`
	ToolUses        []ParsedToolCall `json:"toolUses"`
}

type ParsedConversation struct {
	ID           string `json:"id"`
	TraceID      string `json:"traceId"`
	ParentID     string `json:"parentId"`
	Relationship string `json:"relationship"`
	ForkPoint    int    `json:"forkPoint"`
	AdapterID    string `json:"adapterId"`
	Name         string `json:"name"`
	Cwd          string `json:"cwd"`
	GitRemote    string `json:"gitRemote"`
	Branch       string `json:"branch"`
	Model        string `json:"model"`
	StartedAt    string `json:"startedAt"`
	EndedAt      string `json:"endedAt"`
	SourcePath   string `json:"sourcePath"`
	SourceFormat string `json:"sourceFormat"`
}

type ConversationBundle struct {
	Conversation ParsedConversation `json:"conversation"`
	Messages     []ParsedMessage    `json:"messages"`
}

// --- raw JSONL record (only fields we care about) ---

type rawRecord struct {
	Type            string          `json:"type"`
	Subtype         string          `json:"subtype"`
	UUID            string          `json:"uuid"`
	ParentUUID      *string         `json:"parentUuid"`
	AgentID         string          `json:"agentId"`
	IsSidechain     bool            `json:"isSidechain"`
	Timestamp       string          `json:"timestamp"`
	SessionID       string          `json:"sessionId"`
	Cwd             string          `json:"cwd"`
	GitBranch       string          `json:"gitBranch"`
	RequestID       string          `json:"requestId"`
	Content         string          `json:"content"` // for system records
	Summary         string          `json:"summary"`
	Message         json.RawMessage `json:"message"`
	CompactMetadata json.RawMessage `json:"compactMetadata"`
}

type rawMessage struct {
	ID      string          `json:"id"`
	Role    string          `json:"role"`
	Model   string          `json:"model"`
	Content json.RawMessage `json:"content"`
	Usage   *rawUsage       `json:"usage"`
}

type rawUsage struct {
	InputTokens         int `json:"input_tokens"`
	OutputTokens        int `json:"output_tokens"`
	CacheReadTokens     int `json:"cache_read_input_tokens"`
	CacheCreationTokens int `json:"cache_creation_input_tokens"`
}

type rawBlock struct {
	Type       string          `json:"type"`
	Text       string          `json:"text"`
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	Input      json.RawMessage `json:"input"`
	ToolUseID  string          `json:"tool_use_id"`
	Content    json.RawMessage `json:"content"`
	IsError    bool            `json:"is_error"`
	Thinking   string          `json:"thinking"`
}

// --- parser state ---

type segment struct {
	id           string
	relationship string
	parentID     string
	traceID      string
	forkPoint    int
	startedAt    string
	endedAt      string
	cwd          string
	branch       string
	model        string
	name         string
	messages     []ParsedMessage
	modelCounts  map[string]int
	sequence     int
	turn         int
	toolUseRefs  map[string]*ParsedToolCall
	// requestId+messageId+tokens fingerprints we've already counted
	seenUsage            map[string]struct{}
	messageIdentityCount map[string]int
	lastMessageIDByUUID  map[string]string
}

func newSegment(id, relationship, parentID, traceID, cwd, branch string, forkPoint int) *segment {
	return &segment{
		id:           id,
		relationship: relationship,
		parentID:     parentID,
		traceID:      traceID,
		cwd:          cwd,
		branch:       branch,
		forkPoint:    forkPoint,
		modelCounts:  map[string]int{},
		toolUseRefs:  map[string]*ParsedToolCall{},
		seenUsage:    map[string]struct{}{},
		turn:         0,
		messageIdentityCount: map[string]int{},
		lastMessageIDByUUID:  map[string]string{},
	}
}

// --- helpers ---

func flattenContent(raw json.RawMessage) (text string, blocks []rawBlock) {
	if len(raw) == 0 {
		return "", nil
	}
	// content can be either a string or an array of blocks
	if raw[0] == '"' {
		_ = json.Unmarshal(raw, &text)
		return text, nil
	}
	if raw[0] != '[' {
		return "", nil
	}
	if err := json.Unmarshal(raw, &blocks); err != nil {
		return "", nil
	}
	var b strings.Builder
	for _, blk := range blocks {
		if blk.Type == "text" && blk.Text != "" {
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString(blk.Text)
		}
	}
	return b.String(), blocks
}

func toolResultText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
	}
	if raw[0] == '[' {
		var parts []json.RawMessage
		if json.Unmarshal(raw, &parts) == nil {
			var b strings.Builder
			for _, part := range parts {
				var value string
				if json.Unmarshal(part, &value) == nil {
					if b.Len() > 0 {
						b.WriteString("\n")
					}
					b.WriteString(value)
					continue
				}

				var object struct {
					Text string `json:"text"`
				}
				if json.Unmarshal(part, &object) == nil && object.Text != "" {
					if b.Len() > 0 {
						b.WriteString("\n")
					}
					b.WriteString(object.Text)
					continue
				}

				var compact bytes.Buffer
				if err := json.Compact(&compact, part); err == nil {
					if b.Len() > 0 {
						b.WriteString("\n")
					}
					b.Write(compact.Bytes())
					continue
				}
				if b.Len() > 0 {
					b.WriteString("\n")
				}
				b.Write(part)
			}
			return b.String()
		}
	}
	return string(raw)
}

func unrefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func normalizeIso(ts string) string {
	if ts == "" {
		return ""
	}
	parsed, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return ts
	}
	return parsed.UTC().Format("2006-01-02T15:04:05.000Z")
}

func stableHash(parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return fmt.Sprintf("%x", h)[:24]
}

func messageUsageTotals(raw rawRecord, msg rawMessage) (int, int, int, int) {
	if msg.Usage == nil {
		return 0, 0, 0, 0
	}
	return msg.Usage.InputTokens, msg.Usage.OutputTokens, msg.Usage.CacheReadTokens, msg.Usage.CacheCreationTokens
}

func usageFingerprint(raw rawRecord, msg rawMessage, inTok, outTok, cacheRead, cacheWrite int) string {
	requestID := strings.TrimSpace(raw.RequestID)
	messageID := strings.TrimSpace(msg.ID)
	if requestID == "" || messageID == "" {
		return ""
	}
	return fmt.Sprintf("%s\x1f%s\x1f%d\x1f%d\x1f%d\x1f%d", requestID, messageID, inTok, outTok, cacheRead, cacheWrite)
}

func mostFrequentModel(counts map[string]int) string {
	best := ""
	bestN := 0
	for m, n := range counts {
		if n > bestN {
			best, bestN = m, n
		}
	}
	return best
}

func summarizeText(text, fallback string) string {
	flattened := strings.Join(strings.Fields(text), " ")
	if flattened == "" {
		return fallback
	}
	if len(flattened) > 120 {
		return flattened[:117] + "..."
	}
	return flattened
}

func deriveName(messages []ParsedMessage, fallback string) string {
	for _, m := range messages {
		if m.Role == "user" && m.RecordType == "user" && m.Content != "" {
			return summarizeText(m.Content, fallback)
		}
	}
	return fallback
}

func resolveGitRemote(cwd string) string {
	if cwd == "" {
		return ""
	}
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = cwd
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

type parsedRecord struct {
	lineIndex int
	raw       rawRecord
}

type fileMetadata struct {
	conversationID     string
	traceSessionID     string
	parentSessionID    string
	parentLookupNeedles []string
	initialCwd         string
	initialGitBranch   string
	isSubagent         bool
}

type parentLinkInfo struct {
	relationship string
	traceID      string
	parentID     string
	forkPoint    int
}

func messageIdentitySeed(record parsedRecord, sessionID, kind, timestamp string, msg rawMessage) string {
	raw := record.raw
	if strings.TrimSpace(raw.UUID) != "" {
		return strings.TrimSpace(raw.UUID)
	}
	var summary string
	if raw.Type == "summary" {
		summary = raw.Summary
	}
	return stableHash(
		sessionID,
		kind,
		msg.ID,
		raw.Subtype,
		summary,
		timestamp,
		fmt.Sprintf("%d", record.lineIndex),
	)
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}

func isSubagentPath(file string) bool {
	return strings.Contains(filepath.Clean(file), string(os.PathSeparator)+"subagents"+string(os.PathSeparator))
}

func parentSessionIDFromPath(file string) string {
	normalized := filepath.Clean(file)
	marker := string(os.PathSeparator) + "subagents" + string(os.PathSeparator)
	markerIndex := strings.LastIndex(normalized, marker)
	if markerIndex < 0 {
		return ""
	}
	return filepath.Base(normalized[:markerIndex])
}

func structuralParentSourcePath(file, parentSessionID string) string {
	normalized := filepath.Clean(file)
	marker := string(os.PathSeparator) + "subagents" + string(os.PathSeparator)
	markerIndex := strings.LastIndex(normalized, marker)
	if markerIndex < 0 {
		return ""
	}
	parentStem := normalized[:markerIndex]
	if filepath.Base(parentStem) != parentSessionID {
		return ""
	}
	return parentStem + ".jsonl"
}

func subagentConversationID(parentScopeID, sourceConversationID, file string) string {
	fileStem := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	if parentScopeID == "" {
		parentScopeID = fileStem
	}
	if sourceConversationID == "" {
		sourceConversationID = fileStem
	}
	return "agent-" + stableHash(parentScopeID, sourceConversationID, fileStem)
}

func inspectFile(records []parsedRecord, file string) fileMetadata {
	expectsAgentID := isSubagentPath(file)
	parentSessionID := parentSessionIDFromPath(file)
	traceSessionID := ""
	agentID := ""
	initialCwd := ""
	initialGitBranch := ""

	for _, record := range records {
		if traceSessionID == "" && strings.TrimSpace(record.raw.SessionID) != "" {
			traceSessionID = strings.TrimSpace(record.raw.SessionID)
		}
		if agentID == "" && strings.TrimSpace(record.raw.AgentID) != "" {
			agentID = strings.TrimSpace(record.raw.AgentID)
		}
		if initialCwd == "" && strings.TrimSpace(record.raw.Cwd) != "" {
			initialCwd = record.raw.Cwd
		}
		if initialGitBranch == "" && strings.TrimSpace(record.raw.GitBranch) != "" {
			initialGitBranch = record.raw.GitBranch
		}
		hasConversationID := false
		if expectsAgentID {
			hasConversationID = agentID != "" || traceSessionID != ""
		} else {
			hasConversationID = traceSessionID != ""
		}
		if hasConversationID && initialCwd != "" && initialGitBranch != "" {
			break
		}
	}

	fallbackID := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
	sourceConversationID := ""
	if expectsAgentID {
		sourceConversationID = firstNonEmpty(agentID, traceSessionID, fallbackID)
	} else {
		sourceConversationID = firstNonEmpty(traceSessionID, fallbackID)
	}
	conversationID := sourceConversationID
	if expectsAgentID {
		conversationID = subagentConversationID(
			firstNonEmpty(parentSessionID, traceSessionID, fallbackID),
			sourceConversationID,
			file,
		)
	}

	return fileMetadata{
		conversationID:  conversationID,
		traceSessionID:  firstNonEmpty(traceSessionID, parentSessionID, fallbackID),
		parentSessionID: parentSessionID,
		parentLookupNeedles: uniqueStrings([]string{
			sourceConversationID,
			strings.TrimSuffix(filepath.Base(file), filepath.Ext(file)),
			filepath.Base(file),
			strings.TrimPrefix(strings.TrimSuffix(filepath.Base(file), filepath.Ext(file)), "agent-"),
		}),
		initialCwd:       initialCwd,
		initialGitBranch: initialGitBranch,
		isSubagent:       expectsAgentID,
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

func resolveParentLink(file string, metadata fileMetadata) parentLinkInfo {
	parentSessionID := metadata.parentSessionID
	if parentSessionID == "" {
		return parentLinkInfo{
			relationship: "root",
			traceID:      metadata.conversationID,
			parentID:     "",
			forkPoint:    -1,
		}
	}

	fallback := parentLinkInfo{
		relationship: "spawned",
		traceID:      firstNonEmpty(metadata.traceSessionID, parentSessionID),
		parentID:     parentSessionID,
		forkPoint:    -1,
	}
	parentPath := structuralParentSourcePath(file, parentSessionID)
	if parentPath == "" {
		return fallback
	}
	parentPath = filepath.Clean(parentPath)
	if parentPath == filepath.Clean(file) {
		return fallback
	}
	parentBundles, err := parse(parentPath)
	if err != nil || len(parentBundles) == 0 {
		return fallback
	}

	matchedParentID := parentBundles[len(parentBundles)-1].Conversation.ID
	forkPoint := -1
outer:
	for _, bundle := range parentBundles {
		for _, message := range bundle.Messages {
			for _, toolUse := range message.ToolUses {
				haystack := toolUse.Name + "\n" + toolUse.Input + "\n" + toolUse.Output
				for _, needle := range metadata.parentLookupNeedles {
					if needle != "" && strings.Contains(haystack, needle) {
						matchedParentID = bundle.Conversation.ID
						forkPoint = message.Turn
						break outer
					}
				}
			}
		}
	}

	return parentLinkInfo{
		relationship: "spawned",
		traceID:      firstNonEmpty(parentBundles[0].Conversation.TraceID, fallback.traceID),
		parentID:     firstNonEmpty(matchedParentID, fallback.parentID),
		forkPoint:    forkPoint,
	}
}

func nextMessageID(seg *segment, seed string) string {
	occurrence := seg.messageIdentityCount[seed] + 1
	seg.messageIdentityCount[seed] = occurrence
	return stableHash(seg.id, seed, fmt.Sprintf("%d", occurrence))
}

func recordParsedMessageID(seg *segment, rawUUID, parsedID string) {
	if strings.TrimSpace(rawUUID) == "" {
		return
	}
	seg.lastMessageIDByUUID[strings.TrimSpace(rawUUID)] = parsedID
}

func compactionSeed(rootID string, record parsedRecord) string {
	raw := record.raw
	if strings.TrimSpace(raw.UUID) != "" {
		return strings.TrimSpace(raw.UUID)
	}
	if strings.TrimSpace(raw.Timestamp) != "" {
		return strings.TrimSpace(raw.Timestamp)
	}
	return stableHash(rootID, fmt.Sprintf("%d", record.lineIndex))
}

func compactedConversationID(rootID, boundarySeed string) string {
	return stableHash(rootID, boundarySeed)
}

func recordRole(raw rawRecord, msg rawMessage) string {
	if raw.Type == "summary" {
		return "system"
	}
	if raw.Type == "system" {
		return "system"
	}
	if raw.Type != "user" && raw.Type != "assistant" {
		return ""
	}
	if msg.Role == "assistant" || raw.Type == "assistant" {
		return "assistant"
	}
	if msg.Role == "system" {
		return "system"
	}
	return "user"
}

func parseRecords(file string) ([]parsedRecord, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)

	var records []parsedRecord
	lineIndex := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(strings.TrimSpace(string(line))) == 0 {
			lineIndex++
			continue
		}
		var rec rawRecord
		if err := json.Unmarshal(line, &rec); err == nil {
			records = append(records, parsedRecord{lineIndex: lineIndex, raw: rec})
		}
		lineIndex++
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return records, nil
}

// --- main parse loop ---

func parse(file string) ([]ConversationBundle, error) {
	file, _ = filepath.Abs(file)
	records, err := parseRecords(file)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}

	metadata := inspectFile(records, file)
	rootSession := metadata.conversationID
	rootCwd := metadata.initialCwd
	rootBranch := metadata.initialGitBranch
	parentLink := resolveParentLink(file, metadata)

	segments := []*segment{
		newSegment(
			rootSession,
			parentLink.relationship,
			parentLink.parentID,
			firstNonEmpty(parentLink.traceID, metadata.traceSessionID, rootSession),
			rootCwd,
			rootBranch,
			parentLink.forkPoint,
		),
	}
	current := segments[0]
	pendingCompactionSeed := ""

	for _, record := range records {
		raw := record.raw
		if raw.Type == "system" && raw.Subtype == "compact_boundary" {
			pendingCompactionSeed = compactionSeed(rootSession, record)
			if len(current.messages) > 0 {
				current = newSegment(
					compactedConversationID(rootSession, pendingCompactionSeed),
					"compacted",
					current.id,
					segments[0].traceID,
					current.cwd,
					current.branch,
					-1,
				)
				segments = append(segments, current)
			}
		}
		if raw.Type == "summary" && strings.TrimSpace(raw.Summary) != "" {
			currentHasOnlySystemMessages := len(current.messages) > 0
			for _, message := range current.messages {
				if message.Role != "system" {
					currentHasOnlySystemMessages = false
					break
				}
			}
			if len(current.messages) > 0 && !currentHasOnlySystemMessages {
				seed := pendingCompactionSeed
				if seed == "" {
					seed = compactionSeed(rootSession, record)
				}
				current = newSegment(
					compactedConversationID(rootSession, seed),
					"compacted",
					current.id,
					segments[0].traceID,
					current.cwd,
					current.branch,
					-1,
				)
				segments = append(segments, current)
			}
			pendingCompactionSeed = ""
		}

		var msg rawMessage
		if len(raw.Message) > 0 {
			_ = json.Unmarshal(raw.Message, &msg)
		}
		role := recordRole(raw, msg)
		if role == "" {
			current.sequence++
			continue
		}

		timestamp := normalizeIso(raw.Timestamp)
		sequence := current.sequence + 1
		current.sequence = sequence
		parentMessageID := ""
		if raw.ParentUUID != nil {
			parentMessageID = current.lastMessageIDByUUID[strings.TrimSpace(*raw.ParentUUID)]
		}

		if raw.Type == "summary" {
			message := ParsedMessage{
				ID:              nextMessageID(current, messageIdentitySeed(record, rootSession, "summary", timestamp, msg)),
				Role:            "system",
				Content:         raw.Summary,
				RecordType:      "summary",
				Sequence:        sequence,
				Turn:            -1,
				ParentMessageID: parentMessageID,
				Timestamp:       timestamp,
				ToolUses:        []ParsedToolCall{},
			}
			recordParsedMessageID(current, raw.UUID, message.ID)
			current.messages = append(current.messages, message)
			if current.startedAt == "" {
				current.startedAt = timestamp
			}
			current.endedAt = timestamp
			continue
		}

		if raw.Type == "system" {
			content := raw.Subtype
			if raw.Subtype == "compact_boundary" {
				if len(bytes.TrimSpace(raw.CompactMetadata)) == 0 {
					content = "{}"
				} else {
					var buf bytes.Buffer
					if err := json.Compact(&buf, raw.CompactMetadata); err != nil {
						content = string(raw.CompactMetadata)
					} else {
						content = buf.String()
					}
				}
			} else if content == "" {
				content = "system"
			}
			message := ParsedMessage{
				ID:              nextMessageID(current, messageIdentitySeed(record, rootSession, "system", timestamp, msg)),
				Role:            "system",
				Content:         content,
				RecordType:      func() string { if raw.Subtype != "" { return "system:" + raw.Subtype }; return "system" }(),
				Sequence:        sequence,
				Turn:            -1,
				ParentMessageID: parentMessageID,
				Timestamp:       timestamp,
				ToolUses:        []ParsedToolCall{},
			}
			recordParsedMessageID(current, raw.UUID, message.ID)
			current.messages = append(current.messages, message)
			if current.startedAt == "" {
				current.startedAt = timestamp
			}
			current.endedAt = timestamp
			continue
		}

		isSidechain := raw.IsSidechain
		turn := -1
		if !isSidechain && role != "system" {
			if role == "user" {
				current.turn++
			} else if current.turn == 0 {
				current.turn = 1
			}
			turn = current.turn
		}

		textParts := []string{}
		thinkingParts := []string{}
		toolUses := []ParsedToolCall{}
		content, blocks := flattenContent(msg.Content)
		if content != "" {
			textParts = append(textParts, content)
		}
		for blockIndex, b := range blocks {
			switch b.Type {
			case "text":
				// already captured by flattenContent
			case "thinking":
				if b.Thinking != "" {
					thinkingParts = append(thinkingParts, b.Thinking)
				}
			case "tool_use":
				tc := ParsedToolCall{
					ID: func() string {
						if b.ID != "" {
							return b.ID
						}
						return stableHash(strings.TrimSpace(raw.UUID), b.Name, fmt.Sprintf("%d", blockIndex))
					}(),
					Name:       func() string { if b.Name != "" { return b.Name }; return "unknown" }(),
					Input:      func() string { if len(b.Input) == 0 { return "" }; return string(b.Input) }(),
					Output:     "",
					IsError:    false,
					DurationMs: -1,
					Timestamp:  timestamp,
				}
				toolUses = append(toolUses, tc)
			case "tool_result":
				output := toolResultText(b.Content)
				if output != "" {
					textParts = append(textParts, output)
				}
				if b.ToolUseID != "" {
					for idx := range toolUses {
						if toolUses[idx].ID == b.ToolUseID {
							toolUses[idx].Output = output
							toolUses[idx].IsError = b.IsError
							break
						}
					}
				}
			default:
				if b.Text != "" {
					textParts = append(textParts, b.Text)
				}
			}
		}

		thinkingContent := strings.TrimSpace(strings.Join(thinkingParts, "\n\n"))
		messageContent := strings.TrimSpace(strings.Join(textParts, "\n\n"))
		if messageContent == "" && thinkingContent != "" {
			messageContent = thinkingContent
		}
		if messageContent == "" && len(toolUses) > 0 {
			names := make([]string, 0, len(toolUses))
			for _, toolUse := range toolUses {
				names = append(names, "[tool:"+toolUse.Name+"]")
			}
			messageContent = strings.Join(names, "\n")
		}

		inTok, outTok, cacheRead, cacheWrite := messageUsageTotals(raw, msg)
		fingerprint := ""
		if role == "assistant" {
			fingerprint = usageFingerprint(raw, msg, inTok, outTok, cacheRead, cacheWrite)
		}
		if fingerprint != "" {
			if _, seen := current.seenUsage[fingerprint]; seen {
				inTok, outTok, cacheRead, cacheWrite = 0, 0, 0, 0
			} else {
				current.seenUsage[fingerprint] = struct{}{}
			}
		}

		message := ParsedMessage{
			ID:              nextMessageID(current, messageIdentitySeed(record, rootSession, raw.Type, timestamp, msg)),
			Role:            role,
			Content:         messageContent,
			RecordType:      raw.Type,
			Model:           msg.Model,
			Sequence:        sequence,
			Turn:            turn,
			IsSidechain:     isSidechain,
			ParentMessageID: parentMessageID,
			InputTokens:     inTok,
			OutputTokens:    outTok,
			CacheRead:       cacheRead,
			CacheWrite:      cacheWrite,
			ThinkingContent: thinkingContent,
			ThinkingTokens:  func() int { if thinkingContent == "" { return 0 }; return max(1, (len(thinkingContent)+3)/4) }(),
			Timestamp:       timestamp,
			ToolUses:        toolUses,
		}
		recordParsedMessageID(current, raw.UUID, message.ID)
		current.messages = append(current.messages, message)
		if msg.Model != "" {
			current.modelCounts[msg.Model]++
		}
		if current.startedAt == "" {
			current.startedAt = timestamp
		}
		current.endedAt = timestamp
		if current.name == "" && message.Role == "user" && message.RecordType == "user" && message.Content != "" {
			current.name = deriveName([]ParsedMessage{message}, "")
		}
		if current.cwd == "" && raw.Cwd != "" {
			current.cwd = raw.Cwd
		}
		if current.branch == "" && raw.GitBranch != "" {
			current.branch = raw.GitBranch
		}
		for idx := range message.ToolUses {
			tc := &current.messages[len(current.messages)-1].ToolUses[idx]
			current.toolUseRefs[tc.ID] = tc
		}
		for _, b := range blocks {
			if b.Type == "tool_result" && b.ToolUseID != "" {
				if target, ok := current.toolUseRefs[b.ToolUseID]; ok {
					target.Output = toolResultText(b.Content)
					target.IsError = b.IsError
				}
			}
		}
	}

	bundles := make([]ConversationBundle, 0, len(segments))
	for _, s := range segments {
		if len(s.messages) == 0 {
			continue
		}
		conv := ParsedConversation{
			ID:           s.id,
			TraceID:      s.traceID,
			ParentID:     s.parentID,
			Relationship: s.relationship,
			ForkPoint:    s.forkPoint,
			AdapterID:    "claude-code",
			Name: func() string {
				fallback := rootSession[:min(8, len(rootSession))]
				if s.relationship == "spawned" {
					fallback = strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
				}
				if s.name != "" {
					return s.name
				}
				return deriveName(s.messages, fallback)
			}(),
			Cwd:          s.cwd,
			GitRemote:    resolveGitRemote(s.cwd),
			Branch:       s.branch,
			Model:        mostFrequentModel(s.modelCounts),
			StartedAt:    s.startedAt,
			EndedAt:      s.endedAt,
			SourcePath:   file,
			SourceFormat: "jsonl",
		}
		bundles = append(bundles, ConversationBundle{Conversation: conv, Messages: s.messages})
	}
	return bundles, nil
}

type codexTokenUsage struct {
	InputTokens     int
	OutputTokens    int
	CacheRead       int
	ReasoningTokens int
}

type codexLocalSegment struct {
	ID         string
	Messages    []ParsedMessage
	StartedAt   string
	EndedAt     string
	ModelCounts map[string]int
}

type codexLocalFileModel struct {
	SessionID       string
	SourcePath      string
	Cwd             string
	GitRemote       string
	Branch          string
	RootName        string
	AgentNickname   string
	ParentThreadID  string
	SessionTimestamp string
	Segments        []codexLocalSegment
}

type codexResolvedBase struct {
	TraceID      string
	ParentID     string
	Relationship string
	ForkPoint    int
}

type codexLoadedFileModel struct {
	Model codexLocalFileModel
	Base  codexResolvedBase
}

func parseWorkerBundles(params loadConversationParams) ([]ConversationBundle, error) {
	switch strings.TrimSpace(params.Ref.AdapterID) {
	case "", "claude-code":
		return parse(params.Ref.SourcePath)
	case "codex":
		bundle, err := parseCodexBundle(params.Ref.SourcePath, params.Ref.ID)
		if err != nil {
			return nil, err
		}
		if bundle == nil {
			return []ConversationBundle{}, nil
		}
		return []ConversationBundle{*bundle}, nil
	default:
		return nil, fmt.Errorf("unsupported adapter %s", params.Ref.AdapterID)
	}
}

func parseCodexBundle(sourcePath, refID string) (*ConversationBundle, error) {
	loaded, err := loadCodexFileModel(sourcePath)
	if err != nil || loaded == nil {
		return nil, err
	}

	segmentIndex := -1
	for idx := range loaded.Model.Segments {
		if loaded.Model.Segments[idx].ID == refID {
			segmentIndex = idx
			break
		}
	}
	if segmentIndex < 0 {
		return nil, nil
	}

	bundle := buildCodexBundle(*loaded, segmentIndex)
	return &bundle, nil
}

func loadCodexFileModel(sourcePath string) (*codexLoadedFileModel, error) {
	model, err := buildCodexFileModel(sourcePath)
	if err != nil || model == nil {
		return nil, err
	}

	base, err := resolveCodexBase(*model, map[string]struct{}{})
	if err != nil {
		return nil, err
	}

	return &codexLoadedFileModel{
		Model: *model,
		Base:  base,
	}, nil
}

func buildCodexFileModel(sourcePath string) (*codexLocalFileModel, error) {
	fileTimestamp := codexFileTimestamp(sourcePath)
	sessionID := codexDefaultSessionID(sourcePath)
	sessionIDLocked := false
	parentThreadID := ""
	agentNickname := ""
	cwd := ""
	gitRemote := ""
	branch := ""
	sessionTimestamp := fileTimestamp
	currentTurn := -1
	currentModel := ""
	firstUserText := ""
	var currentSegment *codexLocalSegment
	segments := []codexLocalSegment{}
	pendingTools := []ParsedToolCall{}
	pendingToolIndex := map[string]int{}
	pendingThinkingContent := ""
	pendingThinkingTokens := 0
	pendingUsage := codexTokenUsage{}
	pendingAssistantTimestamp := ""
	pendingAssistantModel := ""
	sawLine := false

	ensureSegment := func(timestamp string) *codexLocalSegment {
		if currentSegment == nil {
			segment := codexLocalSegment{
				ID:         sessionID,
				Messages:    []ParsedMessage{},
				StartedAt:   timestamp,
				EndedAt:     timestamp,
				ModelCounts: map[string]int{},
			}
			segments = append(segments, segment)
			currentSegment = &segments[len(segments)-1]
		}
		return currentSegment
	}

	clearPendingAssistant := func() {
		pendingTools = []ParsedToolCall{}
		pendingToolIndex = map[string]int{}
		pendingThinkingContent = ""
		pendingThinkingTokens = 0
		pendingUsage = codexTokenUsage{}
		pendingAssistantTimestamp = ""
		pendingAssistantModel = ""
	}

	hasPendingAssistantState := func() bool {
		return len(pendingTools) > 0 ||
			pendingThinkingContent != "" ||
			pendingThinkingTokens > 0 ||
			pendingUsage.InputTokens > 0 ||
			pendingUsage.OutputTokens > 0 ||
			pendingUsage.CacheRead > 0 ||
			pendingUsage.ReasoningTokens > 0
	}

	addMessage := func(segment *codexLocalSegment, message ParsedMessage) {
		message.Sequence = len(segment.Messages)
		segment.Messages = append(segment.Messages, message)
		if message.Timestamp != "" {
			if segment.StartedAt == "" || message.Timestamp < segment.StartedAt {
				segment.StartedAt = message.Timestamp
			}
			if segment.EndedAt == "" || message.Timestamp > segment.EndedAt {
				segment.EndedAt = message.Timestamp
			}
		}
		if message.Model != "" {
			segment.ModelCounts[message.Model] = segment.ModelCounts[message.Model] + 1
		}
		if message.Role == "user" && firstUserText == "" && strings.TrimSpace(message.Content) != "" {
			firstUserText = message.Content
		}
	}

	flushPendingAssistant := func(timestamp, recordType string) {
		if !hasPendingAssistantState() {
			return
		}
		assistantTimestamp := pendingAssistantTimestamp
		if assistantTimestamp == "" {
			assistantTimestamp = timestamp
		}
		if assistantTimestamp == "" {
			assistantTimestamp = sessionTimestamp
		}
		assistantModel := pendingAssistantModel
		if assistantModel == "" {
			assistantModel = currentModel
		}
		segment := ensureSegment(assistantTimestamp)
		messageID := stableHashSHA1(
			sessionID,
			segment.ID,
			recordType,
			fmt.Sprintf("%d", len(segment.Messages)),
		)
		addMessage(segment, ParsedMessage{
			ID:              messageID,
			Role:            "assistant",
			Content:         "Tool call output",
			RecordType:      recordType,
			Model:           assistantModel,
			Turn:            currentTurn,
			IsSidechain:     false,
			ParentMessageID: "",
			InputTokens:     pendingUsage.InputTokens,
			OutputTokens:    pendingUsage.OutputTokens,
			CacheRead:       pendingUsage.CacheRead,
			CacheWrite:      0,
			ThinkingContent: pendingThinkingContent,
			ThinkingTokens:  maxInt(pendingThinkingTokens, pendingUsage.ReasoningTokens),
			Timestamp:       assistantTimestamp,
			ToolUses:        cloneToolUses(pendingTools),
		})
		clearPendingAssistant()
	}

	err := scanCodexJSONLFile(sourcePath, func(line map[string]any, index int) {
		sawLine = true
		envelopeType := stringValue(line["type"])
		payload := mapValue(line["payload"])
		timestamp := stringValue(line["timestamp"])
		if timestamp == "" {
			timestamp = sessionTimestamp
		}
		if timestamp != "" && sessionTimestamp == "" {
			sessionTimestamp = timestamp
		}

		switch envelopeType {
		case "session_meta":
			if len(payload) == 0 {
				return
			}
			recordSessionID := stringValue(payload["id"])
			if recordSessionID != "" && !sessionIDLocked {
				sessionID = recordSessionID
				sessionIDLocked = true
				if len(segments) == 1 && len(segments[0].Messages) == 0 {
					segments[0].ID = recordSessionID
				}
			}
			if value := stringValue(payload["timestamp"]); value != "" {
				sessionTimestamp = value
			}
			if value := stringValue(payload["cwd"]); value != "" {
				cwd = value
			}
			git := mapValue(payload["git"])
			if value := stringValue(git["repository_url"]); value != "" {
				gitRemote = value
			}
			if value := stringValue(git["branch"]); value != "" {
				branch = value
			}
			parentThreadID = codexExtractParentThreadID(payload["source"], parentThreadID)
			if value := stringValue(payload["forked_from_id"]); parentThreadID == "" && value != "" {
				parentThreadID = value
			}
			if value := codexExtractAgentNickname(payload["source"]); value != "" {
				agentNickname = value
			}
		case "turn_context":
			if len(payload) == 0 {
				return
			}
			if currentTurn < 0 {
				currentTurn = 1
			} else {
				currentTurn += 1
			}
			if value := stringValue(payload["cwd"]); value != "" {
				cwd = value
			}
			if value := stringValue(payload["model"]); value != "" {
				currentModel = value
			}
		case "event_msg":
			if stringValue(payload["type"]) == "token_count" {
				pendingUsage = codexExtractTokenUsage(payload)
				if timestamp != "" {
					pendingAssistantTimestamp = timestamp
				}
				if currentModel != "" {
					pendingAssistantModel = currentModel
				}
			}
		case "compacted":
			flushPendingAssistant(timestamp, "synthetic_assistant")
			boundarySeed := stringValue(payload["id"])
			if boundarySeed == "" {
				boundarySeed = stringValue(payload["turn_id"])
			}
			if boundarySeed == "" {
				boundarySeed = timestamp
			}
			if boundarySeed == "" {
				boundarySeed = fmt.Sprintf("%d", index)
			}
			segment := codexLocalSegment{
				ID: stableHashSHA1(
					sessionID,
					fmt.Sprintf("compacted:%d:%s", len(segments), boundarySeed),
				),
				Messages:    []ParsedMessage{},
				StartedAt:   timestamp,
				EndedAt:     timestamp,
				ModelCounts: map[string]int{},
			}
			segments = append(segments, segment)
			currentSegment = &segments[len(segments)-1]
			for historyIndex, item := range arrayValue(payload["replacement_history"]) {
				history := mapValue(item)
				historyType := stringValue(history["type"])
				switch historyType {
				case "message":
					role := codexNormalizeRole(stringValue(history["role"]))
					content := codexFlattenMessageContent(history["content"])
					if content == "" {
						continue
					}
					messageID := stringValue(history["id"])
					if messageID == "" {
						messageID = stableHashSHA1(
							sessionID,
							currentSegment.ID,
							"replacement_message",
							fmt.Sprintf("%d", historyIndex),
						)
					}
					addMessage(currentSegment, ParsedMessage{
						ID:              messageID,
						Role:            role,
						Content:         content,
						RecordType:      "message",
						Model:           stringValue(history["model"]),
						Turn:            -1,
						IsSidechain:     false,
						ParentMessageID: "",
						InputTokens:     0,
						OutputTokens:    0,
						CacheRead:       0,
						CacheWrite:      0,
						ThinkingContent: "",
						ThinkingTokens:  0,
						Timestamp:       timestamp,
						ToolUses:        []ParsedToolCall{},
					})
				case "compaction":
					addMessage(currentSegment, ParsedMessage{
						ID: stableHashSHA1(
							sessionID,
							currentSegment.ID,
							"replacement_compaction",
							fmt.Sprintf("%d", historyIndex),
						),
						Role:            "system",
						Content:         "Context compacted",
						RecordType:      "compaction",
						Model:           "",
						Turn:            -1,
						IsSidechain:     false,
						ParentMessageID: "",
						InputTokens:     0,
						OutputTokens:    0,
						CacheRead:       0,
						CacheWrite:      0,
						ThinkingContent: "",
						ThinkingTokens:  0,
						Timestamp:       timestamp,
						ToolUses:        []ParsedToolCall{},
					})
				}
			}
		case "response_item":
			if len(payload) == 0 {
				return
			}
			itemType := stringValue(payload["type"])
			switch itemType {
			case "message":
				role := codexNormalizeRole(stringValue(payload["role"]))
				content := codexFlattenMessageContent(payload["content"])
				if role != "assistant" {
					flushPendingAssistant(timestamp, "synthetic_assistant")
					if content == "" {
						return
					}
					segment := ensureSegment(timestamp)
					messageID := stringValue(payload["id"])
					if messageID == "" {
						messageID = stableHashSHA1(
							sessionID,
							segment.ID,
							"message",
							fmt.Sprintf("%d", len(segment.Messages)),
						)
					}
					addMessage(segment, ParsedMessage{
						ID:              messageID,
						Role:            role,
						Content:         content,
						RecordType:      "message",
						Model:           "",
						Turn:            currentTurn,
						IsSidechain:     false,
						ParentMessageID: "",
						InputTokens:     0,
						OutputTokens:    0,
						CacheRead:       0,
						CacheWrite:      0,
						ThinkingContent: "",
						ThinkingTokens:  0,
						Timestamp:       timestamp,
						ToolUses:        []ParsedToolCall{},
					})
					return
				}

				usage := codexSelectUsage(payload, pendingUsage)
				model := stringValue(payload["model"])
				if model == "" {
					model = currentModel
				}
				if model != "" {
					currentModel = model
				}
				segment := ensureSegment(timestamp)
				messageID := stringValue(payload["id"])
				if messageID == "" {
					messageID = stableHashSHA1(
						sessionID,
						segment.ID,
						"assistant",
						fmt.Sprintf("%d", len(segment.Messages)),
					)
				}
				addMessage(segment, ParsedMessage{
					ID:              messageID,
					Role:            "assistant",
					Content:         valueOrDefault(content, "Tool call output"),
					RecordType:      "message",
					Model:           model,
					Turn:            currentTurn,
					IsSidechain:     false,
					ParentMessageID: "",
					InputTokens:     usage.InputTokens,
					OutputTokens:    usage.OutputTokens,
					CacheRead:       usage.CacheRead,
					CacheWrite:      0,
					ThinkingContent: pendingThinkingContent,
					ThinkingTokens:  maxInt(pendingThinkingTokens, pendingUsage.ReasoningTokens),
					Timestamp:       timestamp,
					ToolUses:        cloneToolUses(pendingTools),
				})
				clearPendingAssistant()
			case "reasoning":
				pendingThinkingContent = codexFlattenReasoningSummary(payload["summary"])
				pendingThinkingTokens = maxInt(pendingThinkingTokens, pendingUsage.ReasoningTokens)
				if timestamp != "" {
					pendingAssistantTimestamp = timestamp
				}
				if currentModel != "" {
					pendingAssistantModel = currentModel
				}
			case "function_call", "custom_tool_call", "web_search_call":
				segment := ensureSegment(timestamp)
				toolIndex := len(pendingTools)
				tool := codexParseToolCall(payload, itemType, timestamp, sessionID, segment.ID, toolIndex)
				pendingTools = append(pendingTools, tool)
				callKey := stringValue(payload["call_id"])
				if callKey == "" {
					callKey = stringValue(payload["id"])
				}
				if callKey != "" {
					pendingToolIndex[callKey] = toolIndex
				}
				if timestamp != "" {
					pendingAssistantTimestamp = timestamp
				}
				if currentModel != "" {
					pendingAssistantModel = currentModel
				}
			case "function_call_output", "custom_tool_call_output":
				callKey := stringValue(payload["call_id"])
				if callKey == "" {
					callKey = stringValue(payload["id"])
				}
				if toolIndex, ok := pendingToolIndex[callKey]; ok && toolIndex < len(pendingTools) {
					output, isError, durationMs := codexParseToolOutput(payload, itemType)
					pendingTools[toolIndex].Output = output
					pendingTools[toolIndex].IsError = pendingTools[toolIndex].IsError || isError
					if durationMs >= 0 {
						pendingTools[toolIndex].DurationMs = durationMs
					}
				}
				if timestamp != "" {
					pendingAssistantTimestamp = timestamp
				}
			}
		}
	})
	if err != nil {
		return nil, err
	}
	if !sawLine {
		return nil, nil
	}

	flushPendingAssistant(sessionTimestamp, "synthetic_assistant")
	if len(segments) == 0 {
		segments = append(segments, codexLocalSegment{
			ID:         sessionID,
			Messages:    []ParsedMessage{},
			StartedAt:   sessionTimestamp,
			EndedAt:     sessionTimestamp,
			ModelCounts: map[string]int{},
		})
	}

	return &codexLocalFileModel{
		SessionID:        sessionID,
		SourcePath:       sourcePath,
		Cwd:              cwd,
		GitRemote:        gitRemote,
		Branch:           branch,
		RootName:         codexSummarizeName(firstUserText, valueOrDefault(agentNickname, sliceString(sessionID, 8))),
		AgentNickname:    agentNickname,
		ParentThreadID:   parentThreadID,
		SessionTimestamp: sessionTimestamp,
		Segments:         segments,
	}, nil
}

func buildCodexBundle(loaded codexLoadedFileModel, index int) ConversationBundle {
	segment := loaded.Model.Segments[index]
	parentID := loaded.Base.ParentID
	relationship := loaded.Base.Relationship
	forkPoint := loaded.Base.ForkPoint
	if index > 0 {
		parentID = loaded.Model.Segments[index-1].ID
		relationship = "compacted"
		forkPoint = -1
	}

	conversation := ParsedConversation{
		ID:           segment.ID,
		TraceID:      loaded.Base.TraceID,
		ParentID:     parentID,
		Relationship: relationship,
		ForkPoint:    forkPoint,
		AdapterID:    "codex",
		Name:         loaded.Model.RootName,
		Cwd:          loaded.Model.Cwd,
		GitRemote:    loaded.Model.GitRemote,
		Branch:       loaded.Model.Branch,
		Model:        mostFrequentModel(segment.ModelCounts),
		StartedAt:    valueOrDefault(segment.StartedAt, loaded.Model.SessionTimestamp),
		EndedAt:      valueOrDefault(segment.EndedAt, loaded.Model.SessionTimestamp),
		SourcePath:   loaded.Model.SourcePath,
		SourceFormat: "jsonl",
	}

	return ConversationBundle{
		Conversation: conversation,
		Messages:     segment.Messages,
	}
}

func resolveCodexBase(model codexLocalFileModel, visited map[string]struct{}) (codexResolvedBase, error) {
	if model.ParentThreadID == "" || model.ParentThreadID == model.SessionID {
		traceID := model.SessionID
		if len(model.Segments) > 0 {
			traceID = model.Segments[0].ID
		}
		return codexResolvedBase{
			TraceID:      traceID,
			ParentID:     "",
			Relationship: "root",
			ForkPoint:    -1,
		}, nil
	}

	if _, ok := visited[model.SourcePath]; ok {
		return codexResolvedBase{
			TraceID:      model.ParentThreadID,
			ParentID:     model.ParentThreadID,
			Relationship: "spawned",
			ForkPoint:    -1,
		}, nil
	}
	visited[model.SourcePath] = struct{}{}

	sessionIndex, err := buildCodexSessionIndex(model.SourcePath)
	if err != nil {
		return codexResolvedBase{}, err
	}
	parentPath := sessionIndex[model.ParentThreadID]
	if parentPath == "" {
		return codexResolvedBase{
			TraceID:      model.ParentThreadID,
			ParentID:     model.ParentThreadID,
			Relationship: "spawned",
			ForkPoint:    -1,
		}, nil
	}

	parentModel, err := buildCodexFileModel(parentPath)
	if err != nil || parentModel == nil {
		return codexResolvedBase{
			TraceID:      model.ParentThreadID,
			ParentID:     model.ParentThreadID,
			Relationship: "spawned",
			ForkPoint:    -1,
		}, err
	}
	parentBase, err := resolveCodexBase(*parentModel, visited)
	if err != nil {
		return codexResolvedBase{}, err
	}
	spawnParentID, forkPoint := codexFindSpawnLink(*parentModel, model.SessionID, model.AgentNickname)
	if spawnParentID == "" {
		if len(parentModel.Segments) > 0 {
			spawnParentID = parentModel.Segments[0].ID
		} else {
			spawnParentID = model.ParentThreadID
		}
		forkPoint = -1
	}

	return codexResolvedBase{
		TraceID:      parentBase.TraceID,
		ParentID:     spawnParentID,
		Relationship: "spawned",
		ForkPoint:    forkPoint,
	}, nil
}

func codexFindSpawnLink(parentModel codexLocalFileModel, childSessionID, childNickname string) (string, int) {
	for _, segment := range parentModel.Segments {
		for _, message := range segment.Messages {
			for _, tool := range message.ToolUses {
				if tool.Name != "spawn_agent" {
					continue
				}
				output := parseJSONString(tool.Output)
				outputObject := mapValue(output)
				agentID := stringValue(outputObject["agent_id"])
				nickname := stringValue(outputObject["nickname"])
				if agentID == childSessionID || (childNickname != "" && nickname == childNickname) {
					return segment.ID, message.Turn
				}
			}
		}
	}
	return "", -1
}

func buildCodexSessionIndex(sourcePath string) (map[string]string, error) {
	codexHome := codexHomeFromSourcePath(sourcePath)
	if codexHome == "" {
		return map[string]string{}, nil
	}
	roots := []string{
		filepath.Join(codexHome, "sessions"),
		filepath.Join(codexHome, "archived_sessions"),
	}
	index := map[string]string{}
	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				return nil
			}
			if filepath.Ext(path) != ".jsonl" {
				return nil
			}
			sessionID := codexDefaultSessionID(path)
			_ = scanCodexJSONLFile(path, func(line map[string]any, _ int) {
				if stringValue(line["type"]) != "session_meta" {
					return
				}
				payload := mapValue(line["payload"])
				if recordSessionID := stringValue(payload["id"]); recordSessionID != "" {
					sessionID = recordSessionID
				}
			})
			if sessionID != "" {
				index[sessionID] = path
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return index, nil
}

func codexDefaultSessionID(sourcePath string) string {
	name := strings.TrimSuffix(filepath.Base(sourcePath), ".jsonl")
	return strings.TrimPrefix(name, "rollout-")
}

func codexFileTimestamp(sourcePath string) string {
	info, err := os.Stat(sourcePath)
	if err != nil {
		return time.Now().UTC().Format(time.RFC3339Nano)
	}
	return info.ModTime().UTC().Format(time.RFC3339Nano)
}

func codexHomeFromSourcePath(sourcePath string) string {
	cleaned := filepath.Clean(sourcePath)
	segments := strings.Split(cleaned, string(os.PathSeparator))
	for idx, segment := range segments {
		if segment == "sessions" || segment == "archived_sessions" {
			return strings.Join(segments[:idx], string(os.PathSeparator))
		}
	}
	return ""
}

func scanCodexJSONLFile(sourcePath string, visit func(map[string]any, int)) error {
	file, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 8*1024*1024)
	index := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var parsed map[string]any
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			continue
		}
		visit(parsed, index)
		index += 1
	}
	return scanner.Err()
}

func codexExtractParentThreadID(source any, fallback string) string {
	sourceObject := mapValue(source)
	subagent := mapValue(sourceObject["subagent"])
	threadSpawn := mapValue(subagent["thread_spawn"])
	if value := stringValue(threadSpawn["parent_thread_id"]); value != "" {
		return value
	}
	return fallback
}

func codexExtractAgentNickname(source any) string {
	sourceObject := mapValue(source)
	subagent := mapValue(sourceObject["subagent"])
	threadSpawn := mapValue(subagent["thread_spawn"])
	return stringValue(threadSpawn["agent_nickname"])
}

func codexExtractTokenUsage(payload map[string]any) codexTokenUsage {
	info := mapValue(payload["info"])
	lastTokenUsage := mapValue(info["last_token_usage"])
	return codexTokenUsage{
		InputTokens:     intValue(lastTokenUsage["input_tokens"]),
		OutputTokens:    intValue(lastTokenUsage["output_tokens"]),
		CacheRead:       intValue(lastTokenUsage["cached_input_tokens"]),
		ReasoningTokens: intValue(lastTokenUsage["reasoning_output_tokens"]),
	}
}

func codexSelectUsage(payload map[string]any, pendingUsage codexTokenUsage) codexTokenUsage {
	usage := mapValue(payload["usage"])
	direct := codexTokenUsage{
		InputTokens:  intValue(usage["input_tokens"]),
		OutputTokens: intValue(usage["output_tokens"]),
		CacheRead:    intValue(usage["cached_input_tokens"]),
	}
	if direct.InputTokens != 0 || direct.OutputTokens != 0 || direct.CacheRead != 0 {
		return direct
	}
	return pendingUsage
}

func codexParseToolCall(payload map[string]any, itemType, timestamp, sessionID, segmentID string, toolIndex int) ParsedToolCall {
	name := itemType
	if itemType == "web_search_call" {
		name = "web_search"
	} else if value := stringValue(payload["name"]); value != "" {
		name = value
	}
	callID := stringValue(payload["call_id"])
	if callID == "" {
		callID = stringValue(payload["id"])
	}
	input := ""
	switch itemType {
	case "custom_tool_call":
		input = stringValue(payload["input"])
	case "function_call":
		input = stringValue(payload["arguments"])
	default:
		input = mustJSON(payload)
	}
	id := callID
	if id == "" {
		id = stableHashSHA1(sessionID, segmentID, name, fmt.Sprintf("%d", toolIndex))
	}
	return ParsedToolCall{
		ID:         id,
		Name:       name,
		Input:      input,
		Output:     "",
		IsError:    stringValue(payload["status"]) == "failed",
		DurationMs: -1,
		Timestamp:  timestamp,
	}
}

func codexParseToolOutput(payload map[string]any, itemType string) (string, bool, int) {
	rawOutput := stringValue(payload["output"])
	if rawOutput == "" {
		return "", false, -1
	}
	if itemType == "custom_tool_call_output" {
		parsed := parseJSONString(rawOutput)
		parsedObject := mapValue(parsed)
		if len(parsedObject) > 0 {
			output := stringValue(parsedObject["output"])
			if output == "" {
				output = stringValue(parsedObject["stdout"])
			}
			if output == "" {
				output = rawOutput
			}
			durationSeconds, hasDuration := floatValue(parsedObject["duration_seconds"])
			durationMs := -1
			if hasDuration {
				durationMs = int(durationSeconds * 1000)
			}
			return output, intValue(parsedObject["exit_code"]) != 0, durationMs
		}
	}
	return rawOutput, false, -1
}

func codexFlattenMessageContent(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			block := mapValue(item)
			text := stringValue(block["text"])
			if text == "" {
				continue
			}
			parts = append(parts, text)
		}
		return strings.Join(parts, "\n\n")
	default:
		return ""
	}
}

func codexFlattenReasoningSummary(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			block := mapValue(item)
			text := stringValue(block["text"])
			if text == "" {
				text = stringValue(block["summary"])
			}
			if text == "" {
				continue
			}
			parts = append(parts, text)
		}
		return strings.Join(parts, "\n\n")
	default:
		return ""
	}
}

func codexNormalizeRole(role string) string {
	if role == "assistant" || role == "user" {
		return role
	}
	return "system"
}

func codexSummarizeName(content, fallback string) string {
	flattened := strings.Join(strings.Fields(content), " ")
	if flattened == "" {
		return fallback
	}
	if len(flattened) > 120 {
		return flattened[:120]
	}
	return flattened
}

func stableHashSHA1(parts ...string) string {
	sum := sha1.Sum([]byte(strings.Join(parts, "\u241f")))
	return fmt.Sprintf("%x", sum)
}

func mapValue(value any) map[string]any {
	if mapped, ok := value.(map[string]any); ok {
		return mapped
	}
	return map[string]any{}
}

func arrayValue(value any) []any {
	if values, ok := value.([]any); ok {
		return values
	}
	return []any{}
}

func stringValue(value any) string {
	if typed, ok := value.(string); ok {
		return typed
	}
	return ""
}

func intValue(value any) int {
	if asInt, ok := value.(int); ok {
		return asInt
	}
	if asFloat, ok := value.(float64); ok {
		return int(asFloat)
	}
	return 0
}

func floatValue(value any) (float64, bool) {
	if asFloat, ok := value.(float64); ok {
		return asFloat, true
	}
	if asInt, ok := value.(int); ok {
		return float64(asInt), true
	}
	return 0, false
}

func parseJSONString(raw string) any {
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil
	}
	return parsed
}

func mustJSON(value any) string {
	bytes, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(bytes)
}

func valueOrDefault(value, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func sliceString(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func cloneToolUses(toolUses []ParsedToolCall) []ParsedToolCall {
	if len(toolUses) == 0 {
		return []ParsedToolCall{}
	}
	return append([]ParsedToolCall(nil), toolUses...)
}

// --- summary stats matching ts-bench.ts ---

type summary struct {
	Target              string  `json:"target"`
	TargetSizeBytes     int64   `json:"targetSizeBytes"`
	ConversationsCount  int     `json:"conversationsCount"`
	TotalMessages       int     `json:"totalMessages"`
	TotalToolCalls      int     `json:"totalToolCalls"`
	TotalInputTokens    int     `json:"totalInputTokens"`
	TotalOutputTokens   int     `json:"totalOutputTokens"`
	TotalCacheRead      int     `json:"totalCacheRead"`
	TotalCacheWrite     int     `json:"totalCacheWrite"`
	TotalThinkingTokens int     `json:"totalThinkingTokens"`
	TotalMs             float64 `json:"totalMs"`
	RssPeakMB           float64 `json:"rssPeakMB"`
}

const (
	jsonRPCVersion            = "2.0"
	initializeMethod          = "initialize"
	loadConversationMethod    = "jin.ingest.loadConversation"
	workerStartedMethod       = "jin.worker.started"
	ingestConversationMethod  = "jin.ingest.conversation"
	ingestMessageMethod       = "jin.ingest.message"
	ingestMissingMethod       = "jin.ingest.missing"
)

type jsonRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type loadConversationParams struct {
	Ref struct {
		ID         string `json:"id"`
		SourcePath string `json:"sourcePath"`
		AdapterID  string `json:"adapterId"`
	} `json:"ref"`
}

func orderedMessages(messages []ParsedMessage) []ParsedMessage {
	for i := 1; i < len(messages); i++ {
		if messages[i-1].Sequence > messages[i].Sequence {
			sorted := append([]ParsedMessage(nil), messages...)
			sort.Slice(sorted, func(left, right int) bool {
				return sorted[left].Sequence < sorted[right].Sequence
			})
			return sorted
		}
	}
	return messages
}

func orderedToolUses(toolUses []ParsedToolCall) []ParsedToolCall {
	for i := 1; i < len(toolUses); i++ {
		if strings.Compare(toolUses[i-1].ID, toolUses[i].ID) > 0 {
			sorted := append([]ParsedToolCall(nil), toolUses...)
			sort.Slice(sorted, func(left, right int) bool {
				return strings.Compare(sorted[left].ID, sorted[right].ID) < 0
			})
			return sorted
		}
	}
	return toolUses
}

func appendObjectProperty(buf *strings.Builder, name string, value any) {
	buf.WriteString(strconvJSONString(name))
	buf.WriteString(":")
	switch typed := value.(type) {
	case func(*strings.Builder):
		typed(buf)
	case string:
		buf.WriteString(strconvJSONString(typed))
	case int:
		buf.WriteString(fmt.Sprintf("%d", typed))
	case bool:
		if typed {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	default:
		raw, _ := json.Marshal(typed)
		buf.Write(raw)
	}
}

func appendJSONObject(buf *strings.Builder, write func(func(string, any))) {
	first := true
	buf.WriteString("{")
	write(func(name string, value any) {
		if !first {
			buf.WriteString(",")
		}
		first = false
		appendObjectProperty(buf, name, value)
	})
	buf.WriteString("}")
}

func appendJSONArray[T any](buf *strings.Builder, values []T, writeValue func(*strings.Builder, T)) {
	buf.WriteString("[")
	for i, value := range values {
		if i > 0 {
			buf.WriteString(",")
		}
		writeValue(buf, value)
	}
	buf.WriteString("]")
}

func appendToolCallHashEntry(buf *strings.Builder, tool ParsedToolCall) {
	appendJSONObject(buf, func(appendProperty func(string, any)) {
		appendProperty("id", tool.ID)
		appendProperty("name", tool.Name)
		appendProperty("input", tool.Input)
		appendProperty("output", tool.Output)
		appendProperty("isError", tool.IsError)
		appendProperty("durationMs", tool.DurationMs)
		appendProperty("timestamp", tool.Timestamp)
	})
}

func appendMessageHashEntry(buf *strings.Builder, message ParsedMessage) {
	appendJSONObject(buf, func(appendProperty func(string, any)) {
		appendProperty("id", message.ID)
		appendProperty("role", message.Role)
		appendProperty("content", message.Content)
		appendProperty("recordType", message.RecordType)
		appendProperty("model", message.Model)
		appendProperty("sequence", message.Sequence)
		appendProperty("turn", message.Turn)
		appendProperty("isSidechain", message.IsSidechain)
		appendProperty("parentMessageId", message.ParentMessageID)
		appendProperty("inputTokens", message.InputTokens)
		appendProperty("outputTokens", message.OutputTokens)
		appendProperty("cacheRead", message.CacheRead)
		appendProperty("cacheWrite", message.CacheWrite)
		appendProperty("thinkingContent", message.ThinkingContent)
		appendProperty("thinkingTokens", message.ThinkingTokens)
		appendProperty("timestamp", message.Timestamp)
		appendProperty("toolUses", func(buf *strings.Builder) {
			appendJSONArray(buf, orderedToolUses(message.ToolUses), appendToolCallHashEntry)
		})
	})
}

func computeBundleHash(bundle ConversationBundle) string {
	var buf strings.Builder
	buf.WriteString("{")
	appendObjectProperty(&buf, "conversation", func(buf *strings.Builder) {
		appendJSONObject(buf, func(appendProperty func(string, any)) {
			appendProperty("id", bundle.Conversation.ID)
			appendProperty("traceId", bundle.Conversation.TraceID)
			appendProperty("parentId", bundle.Conversation.ParentID)
			appendProperty("relationship", bundle.Conversation.Relationship)
			appendProperty("forkPoint", bundle.Conversation.ForkPoint)
			appendProperty("adapterId", bundle.Conversation.AdapterID)
			appendProperty("name", bundle.Conversation.Name)
			appendProperty("cwd", bundle.Conversation.Cwd)
			appendProperty("gitRemote", bundle.Conversation.GitRemote)
			appendProperty("branch", bundle.Conversation.Branch)
			appendProperty("model", bundle.Conversation.Model)
			appendProperty("startedAt", bundle.Conversation.StartedAt)
			appendProperty("endedAt", bundle.Conversation.EndedAt)
			appendProperty("sourcePath", bundle.Conversation.SourcePath)
			appendProperty("sourceFormat", bundle.Conversation.SourceFormat)
		})
	})
	buf.WriteString(",")
	appendObjectProperty(&buf, "messages", func(buf *strings.Builder) {
		appendJSONArray(buf, orderedMessages(bundle.Messages), appendMessageHashEntry)
	})
	buf.WriteString("}")
	sum := sha256.Sum256([]byte(buf.String()))
	return fmt.Sprintf("%x", sum)
}

func strconvJSONString(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func goWorkerDebugEnabled() bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv("JIN_EXPERIMENT_CLAUDE_CODE_GO_DEBUG")))
	return value == "1" || value == "true" || value == "yes"
}

func goWorkerDebugf(format string, args ...any) {
	if !goWorkerDebugEnabled() {
		return
	}
	fmt.Fprintf(os.Stderr, "go-claude-worker: "+format+"\n", args...)
}

func writeFramedJSON(w io.Writer, value any) error {
	body, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, "Content-Length: %d\r\n\r\n", len(body)); err != nil {
		return err
	}
	_, err = w.Write(body)
	return err
}

func readFramedJSON(r *bufio.Reader) ([]byte, error) {
	contentLength := -1
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			if err == io.EOF && contentLength < 0 {
				return nil, io.EOF
			}
			return nil, err
		}
		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			break
		}
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "content-length:") {
			_, err := fmt.Sscanf(trimmed, "Content-Length: %d", &contentLength)
			if err != nil {
				_, err = fmt.Sscanf(trimmed, "content-length: %d", &contentLength)
				if err != nil {
					return nil, err
				}
			}
		}
	}
	if contentLength < 0 {
		return nil, fmt.Errorf("missing Content-Length header")
	}
	body := make([]byte, contentLength)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, err
	}
	return body, nil
}

func writeWorkerStarted(adapterID, refID, sourcePath string) error {
	return writeFramedJSON(os.Stdout, map[string]any{
		"jsonrpc": jsonRPCVersion,
		"method":  workerStartedMethod,
		"params": map[string]any{
			"adapterId":  adapterID,
			"refId":      refID,
			"sourcePath": sourcePath,
			"pid":        os.Getpid(),
		},
	})
}

func writeWorkerNotification(method string, params any) error {
	return writeFramedJSON(os.Stdout, map[string]any{
		"jsonrpc": jsonRPCVersion,
		"method":  method,
		"params":  params,
	})
}

func runWorkerServer() error {
	reader := bufio.NewReader(os.Stdin)
	for {
		body, err := readFramedJSON(reader)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		var request jsonRPCRequest
		if err := json.Unmarshal(body, &request); err != nil {
			return err
		}

		switch request.Method {
		case initializeMethod:
			if err := writeFramedJSON(os.Stdout, map[string]any{
				"jsonrpc": jsonRPCVersion,
				"id":      request.ID,
				"result": map[string]any{
					"protocolVersion": 1,
					"methods":         []string{loadConversationMethod},
					"notifications": []string{
						workerStartedMethod,
						ingestConversationMethod,
						ingestMessageMethod,
						ingestMissingMethod,
					},
				},
			}); err != nil {
				return err
			}
		case loadConversationMethod:
			var params loadConversationParams
			if err := json.Unmarshal(request.Params, &params); err != nil {
				return err
			}
			adapterID := strings.TrimSpace(params.Ref.AdapterID)
			if adapterID == "" {
				adapterID = "claude-code"
			}
			if err := writeWorkerStarted(adapterID, params.Ref.ID, params.Ref.SourcePath); err != nil {
				return err
			}
			bundles, err := parseWorkerBundles(params)
			if err != nil {
				return err
			}
			var bundle *ConversationBundle
			for idx := range bundles {
				if bundles[idx].Conversation.ID == params.Ref.ID {
					bundle = &bundles[idx]
					break
				}
			}
			if bundle == nil {
				parsedIDs := make([]string, 0, len(bundles))
				for _, candidate := range bundles {
					parsedIDs = append(parsedIDs, candidate.Conversation.ID)
				}
				goWorkerDebugf(
					"missing requested ref id=%s source=%s parsed_ids=%v",
					params.Ref.ID,
					params.Ref.SourcePath,
					parsedIDs,
				)
				if err := writeWorkerNotification(ingestMissingMethod, map[string]any{
					"adapterId": adapterID,
					"refId":     params.Ref.ID,
				}); err != nil {
					return err
				}
				if err := writeFramedJSON(os.Stdout, map[string]any{
					"jsonrpc": jsonRPCVersion,
					"id":      request.ID,
					"result":  map[string]any{"kind": "missing"},
				}); err != nil {
					return err
				}
				continue
			}

			if err := writeWorkerNotification(ingestConversationMethod, map[string]any{
				"adapterId":     adapterID,
				"refId":         params.Ref.ID,
				"conversation":  bundle.Conversation,
			}); err != nil {
				return err
			}
			messages := orderedMessages(bundle.Messages)
			for _, message := range messages {
				if err := writeWorkerNotification(ingestMessageMethod, map[string]any{
					"adapterId": adapterID,
					"refId":     params.Ref.ID,
					"message":   message,
				}); err != nil {
					return err
				}
			}
			if err := writeFramedJSON(os.Stdout, map[string]any{
				"jsonrpc": jsonRPCVersion,
				"id":      request.ID,
				"result": map[string]any{
					"kind":        "loaded",
					"bundleHash":  computeBundleHash(*bundle),
					"messageCount": len(messages),
				},
			}); err != nil {
				return err
			}
		default:
			if err := writeFramedJSON(os.Stdout, map[string]any{
				"jsonrpc": jsonRPCVersion,
				"id":      request.ID,
				"error": map[string]any{
					"code":    -32601,
					"message": "method not found",
				},
			}); err != nil {
				return err
			}
		}
	}
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "worker" {
		if err := runWorkerServer(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	out := flag.String("out", "tools/parser-spike/bundle-go.json", "output bundle path")
	flag.Parse()
	if flag.NArg() != 1 {
		fmt.Fprintln(os.Stderr, "usage: go-parser <jsonl-path> [-out=path]")
		os.Exit(2)
	}
	target := flag.Arg(0)

	st, err := os.Stat(target)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	t0 := time.Now()
	bundles, err := parse(target)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	totalMs := float64(time.Since(t0).Microseconds()) / 1000.0

	var s summary
	s.Target = target
	s.TargetSizeBytes = st.Size()
	s.ConversationsCount = len(bundles)
	for _, b := range bundles {
		s.TotalMessages += len(b.Messages)
		for _, m := range b.Messages {
			s.TotalToolCalls += len(m.ToolUses)
			s.TotalInputTokens += m.InputTokens
			s.TotalOutputTokens += m.OutputTokens
			s.TotalCacheRead += m.CacheRead
			s.TotalCacheWrite += m.CacheWrite
			s.TotalThinkingTokens += m.ThinkingTokens
		}
	}
	s.TotalMs = totalMs

	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	s.RssPeakMB = float64(ms.Sys) / 1024.0 / 1024.0

	// write bundle file
	outFile, err := os.Create(*out)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	enc := json.NewEncoder(outFile)
	enc.SetIndent("", "  ")
	if err := enc.Encode(map[string]any{
		"summary": s,
		"bundles": bundles,
	}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	outFile.Close()

	// print summary to stderr (matches ts-bench)
	pretty, _ := json.MarshalIndent(s, "", "  ")
	fmt.Fprintln(os.Stderr, string(pretty))
}
