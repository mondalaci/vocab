<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { SessionSummary } from '@/api'
import { plainText } from '@/lib/markdown'
import MessageCard from '@/components/MessageCard.vue'

interface Bubble {
  key: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

const props = defineProps<{
  bubbles: Bubble[]
  busy: boolean
  speaking: boolean
  sessions: SessionSummary[]
}>()

const emit = defineEmits<{
  send: [mode: 'new' | 'continue']
  stop: []
  speak: [text: string]
  open: [id: string]
}>()

const draft = defineModel<string>('draft', { required: true })
const input = ref<HTMLTextAreaElement | null>(null)

const starters = computed(() => props.sessions.slice(0, 6))

/** Enter starts a new conversation; the button on its own does the same. */
function submit(mode: 'new' | 'continue' = 'new'): void {
  if (!draft.value.trim() || props.busy) return
  emit('send', mode)
}

/**
 * Enter: a fresh translation. Ctrl+Enter / Shift+Enter: a follow-up in the
 * thread on screen. Alt+Enter is the way to type a line break instead.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.altKey) return
  event.preventDefault()
  const followUp = event.ctrlKey || event.metaKey || event.shiftKey
  submit(followUp ? 'continue' : 'new')
}

/**
 * The wait before the first token: the session is created, the history is read
 * and the model stream is opened, which can take a couple of seconds. Show that
 * something is happening, and for how long.
 */
const waitingForFirstToken = computed(() => {
  const last = props.bubbles.at(-1)
  return Boolean(last && last.role === 'assistant' && last.streaming && !last.content)
})

const waited = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null

watch(
  waitingForFirstToken,
  (waiting) => {
    if (ticker) {
      clearInterval(ticker)
      ticker = null
    }
    waited.value = 0
    if (waiting) {
      ticker = setInterval(() => {
        waited.value += 1
      }, 1000)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker)
})

/** From the second token on, the caret in the answer is the progress. */
function phaseLabel(): string {
  return waited.value < 1 ? 'Looking it up…' : `Looking it up… ${waited.value}s`
}

/** The headword of an assistant bubble, for the per-message pronounce chip. */
function headword(content: string): string {
  const match = /^\*\*(.+?)\*\*/m.exec(content)
  return match?.[1]?.replace(/\s*\*\[[^\]]*\]\*.*$/, '').trim() ?? plainText(content).slice(0, 60)
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="transcript scroll">
    <div v-if="!bubbles.length" class="empty">
      <p class="empty__lead">Type a word in either language.</p>
      <p class="empty__sub">
        English or Hungarian — the direction is detected. <kbd>Enter</kbd> starts a new
        translation, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> (or <kbd>Shift</kbd>+<kbd>Enter</kbd>)
        asks a follow-up like <em>vs haste</em> or <em>more examples</em> in the thread on screen.
      </p>
      <div v-if="starters.length" class="empty__recent">
        <button
          v-for="entry in starters"
          :key="entry.id"
          class="pill"
          @click="emit('open', entry.id)"
        >
          {{ entry.term || entry.title }}
        </button>
      </div>
    </div>

    <template v-for="bubble in bubbles" :key="bubble.key">
      <p v-if="bubble.role === 'user'" class="said">{{ bubble.content }}</p>
      <div v-else-if="bubble.streaming && !bubble.content" class="thinking" role="status">
        <span class="thinking__dots" aria-hidden="true"><i /><i /><i /></span>
        <span class="thinking__label">{{ phaseLabel() }}</span>
      </div>
      <MessageCard
        v-else
        :content="bubble.content"
        :streaming="Boolean(bubble.streaming)"
        :speaking="speaking"
        @speak="emit('speak', $event)"
      />
    </template>
  </div>

  <form class="composer" @submit.prevent="submit('new')">
    <textarea
      ref="input"
      v-model="draft"
      class="field composer__input"
      rows="1"
      placeholder="word or phrase — ↵ new, Ctrl+↵ follow-up, Alt+↵ newline"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <button v-if="busy" class="composer__go" type="button" @click="emit('stop')">Stop</button>
    <template v-else>
      <button
        v-if="bubbles.length"
        class="composer__follow"
        type="button"
        :disabled="!draft.trim()"
        title="Ask a follow-up in this thread (Ctrl+Enter or Shift+Enter)"
        @click="submit('continue')"
      >
        Follow up
      </button>
      <button class="composer__go" type="submit" :disabled="!draft.trim()">Look up</button>
    </template>
  </form>
</template>

<style scoped>
.transcript {
  flex: 1;
  min-height: 0;
  padding: 16px 18px 4px;
  overflow-y: auto;
}

.empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8vh 4px 0;
  color: var(--dim);
}

.empty__lead {
  margin: 0;
  color: var(--fg);
  font-size: 17px;
}

.empty__sub {
  margin: 0;
  max-width: 34rem;
  font-size: 13.5px;
  line-height: 1.6;
}

.empty__recent {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.said {
  margin: 12px 0 10px auto;
  width: fit-content;
  max-width: 70%;
  padding: 7px 12px;
  color: var(--fg-strong);
  background: var(--card-3);
  border-radius: 12px 12px 3px 12px;
  font-size: 14.5px;
}

.thinking {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 4px 0 14px;
  color: var(--dim);
  font-size: 13.5px;
}

.thinking__dots {
  display: inline-flex;
  gap: 4px;
}

.thinking__dots i {
  width: 6px;
  height: 6px;
  background: var(--accent);
  border-radius: 50%;
  animation: pulse 1.2s ease-in-out infinite;
}

.thinking__dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.thinking__dots i:nth-child(3) {
  animation-delay: 0.3s;
}

.thinking__label {
  font-variant-numeric: tabular-nums;
}

@keyframes pulse {
  0%,
  70%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .thinking__dots i {
    animation: none;
    opacity: 0.7;
  }
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 14px 4px;
  border-top: 1px solid var(--line-soft);
}

.composer__input {
  flex: 1;
  min-height: var(--tap);
  max-height: 26vh;
  padding: 11px 13px;
  font-size: 15.5px;
  line-height: 1.45;
  resize: none;
}

.composer__go {
  flex: none;
  min-height: var(--tap);
  padding: 0 18px;
  color: var(--accent-ink);
  background: var(--accent);
  border-radius: 10px;
  font-weight: 650;
}

.composer__go:disabled,
.composer__follow:disabled {
  color: var(--dimmer);
  background: var(--card-2);
  cursor: default;
}

.composer__follow {
  flex: none;
  min-height: var(--tap);
  padding: 0 14px;
  color: var(--dim);
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-weight: 550;
}

.composer__follow:not(:disabled):hover {
  color: var(--fg);
  border-color: var(--dim);
}
</style>
