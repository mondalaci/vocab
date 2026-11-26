<script setup lang="ts">
import { computed } from 'vue'
import { plainText, renderMarkdown } from '@/lib/markdown'
import { toast } from '@/lib/toast'

const props = defineProps<{
  content: string
  streaming: boolean
  speaking: boolean
}>()

const emit = defineEmits<{ speak: [text: string] }>()

const html = computed(() => renderMarkdown(props.content))

/** The headword, so the pronounce chip says one word and not the whole answer. */
const headword = computed(() => {
  const match = /^\*\*(.+?)\*\*/m.exec(props.content)
  if (!match?.[1]) return plainText(props.content).split(/\s+/).slice(0, 2).join(' ')
  return match[1].replace(/\*.*$/, '').trim()
})

/**
 * Only the words being translated get pronounced: the prompt bolds exactly those
 * (the headword, every sense's target word, both sides of a comparison), so a
 * click on any bold word speaks that word alone. Reading the whole answer aloud
 * was never wanted.
 */
function onClick(event: MouseEvent): void {
  const bold = (event.target as HTMLElement | null)?.closest('strong')
  const word = bold?.textContent?.trim()
  if (!word) return
  event.stopPropagation()
  emit('speak', word)
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(plainText(props.content))
    toast('Copied', 'success')
  } catch {
    toast('Clipboard is blocked here', 'error')
  }
}
</script>

<template>
  <article class="answer">
    <!-- Markdown is sanitised in lib/markdown.ts before it reaches the DOM. -->
    <div
      class="md"
      :class="{ 'md--streaming': streaming }"
      v-html="html"
      @click="onClick"
    />

    <div class="answer__tools">
      <button
        class="chip chip--play"
        :class="{ 'chip--active': speaking }"
        :disabled="streaming || !headword"
        :title="`Say “${headword}” on this machine — P`"
        @click="emit('speak', headword)"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9h3.2L12 5.4v13.2L7.2 15H4z" />
          <path d="M15.4 8.8a4.4 4.4 0 0 1 0 6.4M17.8 6.4a7.6 7.6 0 0 1 0 11.2" />
        </svg>
        {{ speaking ? 'Stop' : `Say ${headword}` }}
      </button>
      <span class="answer__hint">click any bold word to hear it</span>
      <button class="chip" title="Copy" @click="copy">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4H6a2 2 0 0 0-2 2v7.5A1.5 1.5 0 0 0 5.5 15" />
        </svg>
        Copy
      </button>
    </div>
  </article>
</template>

<style scoped>
.answer {
  padding: 2px 0 14px;
  border-bottom: 1px solid var(--line-soft);
}

.answer:last-child {
  border-bottom: 0;
}

.md {
  color: var(--fg-strong);
  font-size: 16px;
  line-height: 1.6;
  word-break: break-word;
}

.md :deep(p) {
  margin: 0 0 0.6em;
}

.md :deep(p:last-child),
.md :deep(ol:last-child),
.md :deep(ul:last-child) {
  margin-bottom: 0;
}

.md :deep(strong) {
  color: var(--accent);
  font-weight: 650;
  /* Every bold word is a pronounce button; say so on hover. */
  cursor: pointer;
  border-radius: 3px;
}

.md :deep(strong:hover) {
  text-decoration: underline;
  text-decoration-style: dotted;
  background: rgba(138, 180, 255, 0.1);
}

.md :deep(strong:active) {
  background: rgba(138, 180, 255, 0.22);
}

.md :deep(em) {
  color: var(--dim);
  font-style: italic;
}

.md :deep(ol),
.md :deep(ul) {
  margin: 0 0 0.6em;
  padding-left: 1.35em;
}

.md :deep(li) {
  margin-bottom: 0.25em;
}

.md :deep(code) {
  padding: 0.1em 0.35em;
  background: var(--card-2);
  border-radius: 5px;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 0.92em;
}

.md--streaming :deep(p:last-child)::after {
  content: '▍';
  color: var(--accent);
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  to {
    visibility: hidden;
  }
}

.answer__tools {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.answer__hint {
  color: var(--dimmer);
  font-size: 11.5px;
}

.answer:hover .answer__tools,
.answer__tools:focus-within {
  opacity: 1;
}
</style>
