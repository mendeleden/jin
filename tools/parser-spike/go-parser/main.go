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
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"runtime"
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
	IsSidechain     bool            `json:"isSidechain"`
	Timestamp       string          `json:"timestamp"`
	SessionID       string          `json:"sessionId"`
	Cwd             string          `json:"cwd"`
	GitBranch       string          `json:"gitBranch"`
	RequestID       string          `json:"requestId"`
	Content         string          `json:"content"` // for system records
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
	parentSeed   string // compact boundary uuid → seeds child id
	startedAt    string
	endedAt      string
	cwd          string
	branch       string
	model        string
	name         string
	messages     []ParsedMessage
	modelCounts  map[string]int
	turn         int
	// tool_use_id → (segment index of message, index in toolUses) for late binding
	toolUseIdx map[string][2]int
	// requestId+messageId+tokens fingerprints we've already counted
	seenUsage map[string]struct{}
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
		toolUseIdx:   map[string][2]int{},
		seenUsage:    map[string]struct{}{},
		turn:         0,
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
		var blocks []rawBlock
		if json.Unmarshal(raw, &blocks) == nil {
			var b strings.Builder
			for _, blk := range blocks {
				if blk.Type == "text" && blk.Text != "" {
					if b.Len() > 0 {
						b.WriteString("\n\n")
					}
					b.WriteString(blk.Text)
				}
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

func deriveName(messages []ParsedMessage) string {
	for _, m := range messages {
		if m.Role == "user" && m.RecordType == "user" && m.Content != "" {
			s := m.Content
			if len(s) > 120 {
				s = s[:120]
			}
			return s
		}
	}
	return ""
}

// --- main parse loop ---

func parse(file string) ([]ConversationBundle, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)

	var (
		segments    []*segment
		current     *segment
		rootSession string
		rootCwd     string
		rootBranch  string
		seq         int
	)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var rec rawRecord
		if err := json.Unmarshal(line, &rec); err != nil {
			continue // forgiving — match TS adapter behavior
		}

		// init root segment lazily on first content-bearing record
		if current == nil && (rec.Type == "user" || rec.Type == "assistant") {
			rootSession = rec.SessionID
			rootCwd = rec.Cwd
			rootBranch = rec.GitBranch
			current = newSegment(rootSession, "root", "", rootSession, rootCwd, rootBranch, -1)
			segments = append(segments, current)
		}

		switch {
		case rec.Type == "system" && rec.Subtype == "compact_boundary":
			// emit the boundary as a message in current segment first
			if current != nil {
				current.messages = append(current.messages, ParsedMessage{
					ID:         rec.UUID,
					Role:       "system",
					Content:    rec.Content,
					RecordType: "system:" + rec.Subtype,
					Sequence:   seq,
					Turn:       current.turn,
					Timestamp:  rec.Timestamp,
					ToolUses:   []ParsedToolCall{},
				})
				seq++
				current.endedAt = rec.Timestamp
			}
			// open a new segment for the continuation
			newID := rec.UUID
			if newID == "" {
				newID = fmt.Sprintf("%s-compact-%d", rootSession, len(segments))
			}
			current = newSegment(newID, "compacted", rootSession, rootSession, rootCwd, rootBranch, -1)
			segments = append(segments, current)

		case rec.Type == "system":
			if current == nil {
				continue
			}
			rt := "system"
			if rec.Subtype != "" {
				rt = "system:" + rec.Subtype
			}
			current.messages = append(current.messages, ParsedMessage{
				ID:         rec.UUID,
				Role:       "system",
				Content:    rec.Content,
				RecordType: rt,
				Sequence:   seq,
				Turn:       current.turn,
				Timestamp:  rec.Timestamp,
				ToolUses:   []ParsedToolCall{},
			})
			seq++
			current.endedAt = rec.Timestamp

		case rec.Type == "user" || rec.Type == "assistant":
			if current == nil {
				continue
			}

			var rmsg rawMessage
			if len(rec.Message) > 0 {
				_ = json.Unmarshal(rec.Message, &rmsg)
			}
			content, blocks := flattenContent(rmsg.Content)

			// turn counting: bump on every non-sidechain user record
			if rec.Type == "user" && !rec.IsSidechain {
				current.turn++
			}

			msg := ParsedMessage{
				ID:              rec.UUID,
				Role:            rec.Type,
				Content:         content,
				RecordType:      rec.Type,
				Model:           rmsg.Model,
				Sequence:        seq,
				Turn:            current.turn,
				IsSidechain:     rec.IsSidechain,
				ParentMessageID: unrefStr(rec.ParentUUID),
				Timestamp:       rec.Timestamp,
				ToolUses:        []ParsedToolCall{},
			}
			seq++

			if rmsg.Usage != nil {
				dup := false
				if rec.Type == "assistant" && rec.RequestID != "" && rmsg.ID != "" {
					fp := fmt.Sprintf("%s\x1f%s\x1f%d\x1f%d\x1f%d\x1f%d",
						rec.RequestID, rmsg.ID,
						rmsg.Usage.InputTokens, rmsg.Usage.OutputTokens,
						rmsg.Usage.CacheReadTokens, rmsg.Usage.CacheCreationTokens)
					if _, seen := current.seenUsage[fp]; seen {
						dup = true
					} else {
						current.seenUsage[fp] = struct{}{}
					}
				}
				if !dup {
					msg.InputTokens = rmsg.Usage.InputTokens
					msg.OutputTokens = rmsg.Usage.OutputTokens
					msg.CacheRead = rmsg.Usage.CacheReadTokens
					msg.CacheWrite = rmsg.Usage.CacheCreationTokens
				}
			}
			if rmsg.Model != "" {
				current.modelCounts[rmsg.Model]++
			}

			// extract tool_use blocks and resolve tool_result references
			for _, b := range blocks {
				switch b.Type {
				case "tool_use":
					inp := ""
					if len(b.Input) > 0 {
						inp = string(b.Input)
					}
					tc := ParsedToolCall{
						ID:         b.ID,
						Name:       b.Name,
						Input:      inp,
						Output:     "",
						IsError:    false,
						DurationMs: -1,
						Timestamp:  rec.Timestamp,
					}
					msg.ToolUses = append(msg.ToolUses, tc)
					current.toolUseIdx[b.ID] = [2]int{len(current.messages), len(msg.ToolUses) - 1}
				case "tool_result":
					if idx, ok := current.toolUseIdx[b.ToolUseID]; ok {
						mIdx, tIdx := idx[0], idx[1]
						if mIdx < len(current.messages) {
							out := toolResultText(b.Content)
							current.messages[mIdx].ToolUses[tIdx].Output = out
							current.messages[mIdx].ToolUses[tIdx].IsError = b.IsError
						}
					}
				case "thinking":
					if b.Thinking != "" {
						if msg.ThinkingContent != "" {
							msg.ThinkingContent += "\n\n"
						}
						msg.ThinkingContent += b.Thinking
					}
				}
			}

			if current.startedAt == "" {
				current.startedAt = rec.Timestamp
			}
			current.endedAt = rec.Timestamp
			current.messages = append(current.messages, msg)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	// finalize bundles
	bundles := make([]ConversationBundle, 0, len(segments))
	for _, s := range segments {
		conv := ParsedConversation{
			ID:           s.id,
			TraceID:      s.traceID,
			ParentID:     s.parentID,
			Relationship: s.relationship,
			ForkPoint:    s.forkPoint,
			AdapterID:    "claude-code",
			Name:         deriveName(s.messages),
			Cwd:          s.cwd,
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

func main() {
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
