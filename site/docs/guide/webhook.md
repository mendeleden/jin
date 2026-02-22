# Webhook Sink

Push session data to any HTTP endpoint as JSON.

## Setup

```sh
jin team-config \
  --type=webhook \
  --url="https://your-api.internal/jin/ingest" \
  --team-id=my-team
```

## Payload format

jin POSTs a JSON array of session objects:

```json
[
  {
    "session": {
      "id": "abc-123",
      "adapterId": "claude-code",
      "name": "Fix auth bug",
      "createdAt": "2025-02-21T10:00:00Z",
      "totalTokens": 15000,
      "estCost": 0.45
    },
    "messages": [...]
  }
]
```

## Custom headers

```sh
jin team-config \
  --type=webhook \
  --url="https://api.example.com/ingest" \
  --headers='{"Authorization": "Bearer sk-..."}' \
  --team-id=my-team
```
