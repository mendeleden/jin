<script setup lang="ts">
import { ref, onMounted } from 'vue'

const os = ref<'unix' | 'windows'>('unix')
const copied = ref(false)

onMounted(() => {
  if (navigator.userAgent?.includes('Windows')) {
    os.value = 'windows'
  }
})

const commands = {
  unix: 'curl -fsSL https://jin.builtbyeden.app/install.sh | sh',
  windows: 'irm https://jin.builtbyeden.app/install.ps1 | iex',
}

function copy() {
  navigator.clipboard.writeText(commands[os.value])
  copied.value = true
  setTimeout(() => { copied.value = false }, 2000)
}
</script>

<template>
  <div class="install-command">
    <div class="tabs">
      <button :class="{ active: os === 'unix' }" @click="os = 'unix'">macOS / Linux</button>
      <button :class="{ active: os === 'windows' }" @click="os = 'windows'">Windows</button>
    </div>
    <div class="code-container">
      <span class="prompt">{{ os === 'windows' ? 'PS>' : '$' }}</span>
      <code>{{ commands[os] }}</code>
      <button class="copy-btn" @click="copy" :title="copied ? 'Copied!' : 'Copy to clipboard'">
        <svg v-if="!copied" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.install-command {
  margin: 1.5rem 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
}

.tabs {
  display: flex;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.tabs button {
  flex: 1;
  padding: 0.5rem 1rem;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: color 0.2s, border-color 0.2s;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tabs button.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.tabs button:hover:not(.active) {
  color: var(--vp-c-text-1);
}

.code-container {
  display: flex;
  align-items: center;
  padding: 0.8rem 1rem;
  background: var(--vp-code-block-bg);
  font-family: var(--vp-font-family-mono);
  font-size: 0.875rem;
  gap: 0.5rem;
  overflow-x: auto;
}

.prompt {
  color: var(--vp-c-text-3);
  user-select: none;
  flex-shrink: 0;
}

code {
  flex: 1;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

.copy-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}

.copy-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}
</style>
