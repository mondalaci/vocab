<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SessionSummary } from '@/api'

const props = defineProps<{ sessions: SessionSummary[]; activeId: string }>()
const emit = defineEmits<{
  open: [id: string]
  remove: [id: string]
  new: []
  search: [query: string]
}>()

const query = ref('')
const confirming = ref('')

const grouped = computed(() => props.sessions)

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function search(): void {
  emit('search', query.value)
}

function remove(id: string): void {
  if (confirming.value !== id) {
    confirming.value = id
    return
  }
  confirming.value = ''
  emit('remove', id)
}
</script>

<template>
  <section class="panel">
    <div class="panel__head">
      <input
        v-model="query"
        class="field panel__search"
        placeholder="search words, threads and answers…"
        autocomplete="off"
        spellcheck="false"
        @input="search"
      />
      <button class="chip" @click="emit('new')">New</button>
    </div>

    <div class="panel__body scroll">
      <p v-if="!grouped.length" class="panel__empty">No sessions yet — look something up.</p>
      <ol v-else class="panel__list">
        <li v-for="entry in grouped" :key="entry.id">
          <div class="row" :data-active="entry.id === activeId">
            <button class="row__main" @click="emit('open', entry.id)">
              <span class="row__term">{{ entry.term || entry.title }}</span>
              <span class="row__meta">
                <span class="row__dir">{{ entry.direction === 'en-hu' ? 'EN↔HU' : 'HU↔EN' }}</span>
                <span>{{ entry.turns }} {{ entry.turns === 1 ? 'turn' : 'turns' }}</span>
                <span>{{ ago(entry.updatedAt) }}</span>
              </span>
            </button>
            <button
              class="row__remove"
              :data-confirm="confirming === entry.id"
              :title="confirming === entry.id ? 'Click again to delete' : 'Delete'"
              @click="remove(entry.id)"
            >
              {{ confirming === entry.id ? 'sure?' : '✕' }}
            </button>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.panel__head {
  display: flex;
  gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--line-soft);
}

.panel__search {
  flex: 1;
}

.panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 8px 12px;
}

.panel__empty {
  margin: 8vh 0 0;
  color: var(--dim);
  text-align: center;
}

.panel__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  border-radius: 10px;
}

.row[data-active='true'] {
  background: #16161c;
}

.row:hover {
  background: var(--card-2);
}

.row__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 9px 10px;
  text-align: left;
}

.row__term {
  overflow: hidden;
  color: var(--fg-strong);
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row__meta {
  display: flex;
  gap: 10px;
  color: var(--dimmer);
  font-size: 11.5px;
}

.row__dir {
  color: var(--dim);
  font-family: ui-monospace, Menlo, monospace;
}

.row__remove {
  flex: none;
  padding: 6px 10px;
  color: var(--dimmer);
  border-radius: 8px;
  font-size: 12px;
}

.row__remove:hover,
.row__remove[data-confirm='true'] {
  color: var(--danger);
  background: #1c1416;
}
</style>
