<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/lib/markdown'

const props = defineProps<{
  content: string
  streaming: boolean
}>()

const emit = defineEmits<{ speak: [text: string] }>()

const html = computed(() => renderMarkdown(props.content))

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
</script>

<template>
  <article class="answer">
    <!-- Markdown is sanitised in lib/markdown.ts before it reaches the DOM. -->
    <div
      class="md"
      :class="{ 'md--streaming': streaming, 'md--empty': streaming && !content }"
      v-html="html"
      @click="onClick"
    />
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

.md--streaming :deep(p:last-child)::after,
.md--empty::after {
  content: '▍';
  color: var(--accent);
  animation: blink 1s steps(2, start) infinite;
}

@keyframes blink {
  to {
    visibility: hidden;
  }
}
</style>
