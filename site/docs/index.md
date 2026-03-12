---
layout: home
hero:
  name: jin
  text: Conversation data pipeline
  tagline: Capture every AI coding session across Claude Code, Cursor, Codex, Warp, Gemini CLI, and more.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Team Setup
      link: /guide/team-setup
features:
  - title: 10 Adapters
    details: Claude Code, Cursor, Codex, Warp, Gemini CLI, Kiro, Amp, OpenCode, Pi, PiAgent — all indexed into a single store.
  - title: 3 Sinks
    details: Push to Webhook, PostgreSQL, or S3/R2. Stream sessions to your team's infrastructure in real-time.
  - title: Auto-Tagging
    details: Sessions tagged by project, tool, model, language, and cost. No manual labeling needed.
  - title: Always Running
    details: Background daemon or OS service. Survives reboots. Self-updates.
---

<div class="home-install">
  <h2>Install</h2>
  <InstallCommand />
</div>

<style>
.home-install {
  max-width: 580px;
  margin: 0 auto;
  padding: 1rem 1.5rem 4rem;
  text-align: center;
}

.home-install h2 {
  margin-bottom: 0.25rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}
</style>
