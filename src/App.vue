<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api, chat, type ChatEvent, type SessionSummary, type Status } from '@/api'
import { toast, toasts } from '@/lib/toast'
import { settings } from '@/lib/settings'
import ChatView from '@/components/ChatView.vue'
import SessionPanel from '@/components/SessionPanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'

interface Bubble {
  key: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

type View = 'chat' | 'sessions' | 'settings'

const status = ref<Status | null>(null)
const sessions = ref<SessionSummary[]>([])
const sessionId = ref('')
const term = ref<string | null>(null)
const direction = ref<'en-hu' | 'hu-en'>('en-hu')
const bubbles = ref<Bubble[]>([])
const view = ref<View>('chat')
const busy = ref(false)
const speaking = ref(false)
const draft = ref('')

let controller: AbortController | null = null
let key = 0

const overlay = window.overlay

const directionLabel = computed(() => {
  const languages = status.value?.languages
  if (!languages) return direction.value === 'en-hu' ? 'EN → HU' : 'HU → EN'
  const english = languages.source.native
  const hungarian = languages.target.native
  return direction.value === 'en-hu' ? `${english} → ${hungarian}` : `${hungarian} → ${english}`
})

async function loadSessions(query = ''): Promise<void> {
  try {
    sessions.value = (await api.sessions(query)).sessions
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Cannot read the sessions', 'error')
  }
}

async function loadStatus(): Promise<void> {
  try {
    status.value = await api.status()
    settings.hideOnBlur = status.value ? settings.hideOnBlur : false
    overlay?.setHideOnBlur(settings.hideOnBlur)
  } catch (error) {
    toast(error instanceof Error ? error.message : 'The server is not answering', 'error', 6000)
  }
}

function applySession(
  id: string,
  next: { term?: string | null; direction?: 'en-hu' | 'hu-en' },
  messages: { role: 'user' | 'assistant'; content: string }[] = [],
): void {
  sessionId.value = id
  settings.lastSessionId = id
  term.value = next.term ?? null
  if (next.direction) direction.value = next.direction
  bubbles.value = messages.map((message) => ({
    key: `m${key++}`,
    role: message.role,
    content: message.content,
  }))
}

async function openSession(id: string): Promise<void> {
  try {
    const found = await api.session(id)
    applySession(
      id,
      { term: found.session.term, direction: found.session.direction },
      found.messages,
    )
    view.value = 'chat'
    focusComposer()
  } catch (error) {
    // A remembered session can be gone (deleted, or the database was cleaned):
    // fall back to a fresh chat rather than complaining on startup.
    if (settings.lastSessionId === id) settings.lastSessionId = ''
    sessionId.value = ''
    term.value = null
    bubbles.value = []
    if (error instanceof Error && !/no such session/i.test(error.message)) {
      toast(error.message, 'error')
    }
  }
}

async function newSession(): Promise<void> {
  abort()
  sessionId.value = ''
  settings.lastSessionId = ''
  term.value = null
  bubbles.value = []
  draft.value = ''
  view.value = 'chat'
  focusComposer()
}

async function send(mode: 'new' | 'continue' = 'new'): Promise<void> {
  const text = draft.value.trim()
  if (!text || busy.value) return
  draft.value = ''
  view.value = 'chat'

  // Enter starts a new conversation, so whatever was on screen belongs to the
  // previous thread: it is already saved, and leaving it visible would suggest
  // the follow-up went into it.
  if (mode === 'new') {
    sessionId.value = ''
    settings.lastSessionId = ''
    term.value = null
    bubbles.value = []
  }

  bubbles.value.push({ key: `u${key++}`, role: 'user', content: text })
  const answer: Bubble = { key: `a${key++}`, role: 'assistant', content: '', streaming: true }
  bubbles.value.push(answer)

  busy.value = true
  const active = new AbortController()
  controller = active

  if (settings.autoSpeak) void speak(text)

  try {
    await chat(
      {
        text,
        ...(sessionId.value ? { sessionId: sessionId.value } : {}),
        ...(sessionId.value ? {} : { direction: direction.value }),
      },
      (event: ChatEvent) => {
        if (event.type === 'meta') {
          applyMeta(event)
        } else if (event.type === 'delta') {
          answer.content += event.text
          scrollToEnd()
        } else if (event.type === 'done') {
          busy.value = false
          void loadSessions()
          if (status.value) status.value.counts.messages += 1
        }
      },
      active.signal,
    )
  } catch (error) {
    answer.streaming = false
    if (!active.signal.aborted) {
      const message = error instanceof Error ? error.message : 'The look-up failed.'
      toast(message, 'error', 6000)
      if (!answer.content) bubbles.value = bubbles.value.filter((bubble) => bubble !== answer)
    }
  } finally {
    if (controller === active) controller = null
    answer.streaming = false
    busy.value = false
    // A stream that ends without a single token (server restarted mid-request,
    // or the model said nothing) should not leave an empty card behind.
    if (!answer.content.trim()) {
      bubbles.value = bubbles.value.filter((bubble) => bubble !== answer)
      if (!active.signal.aborted) toast('No answer came back — try again.', 'error', 5000)
    }
    scrollToEnd()
  }
}

function applyMeta(event: Extract<ChatEvent, { type: 'meta' }>): void {
  sessionId.value = event.sessionId
  settings.lastSessionId = event.sessionId
  if (event.fresh) {
    term.value = event.term
    direction.value = event.direction
  }
}

function abort(): void {
  controller?.abort()
  controller = null
  busy.value = false
}

/** Everything the user hears comes out of this machine, not the browser. */
async function speak(text: string): Promise<void> {
  if (speaking.value) {
    await stopSpeaking()
    return
  }
  const trimmed = text.trim()
  if (!trimmed) return
  if (!status.value?.tts.available || !settings.playOnHost) {
    toast('Speech is switched off, or the server has no key.', 'error', 5000)
    return
  }
  speaking.value = true
  try {
    const result = await api.speak({
      text: trimmed.slice(0, 1200),
      ...(settings.voice ? { voice: settings.voice } : {}),
    })
    if (result.playError) toast(`Playback on this machine: ${result.playError}`, 'error', 6000)
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Speech failed', 'error', 6000)
  } finally {
    speaking.value = false
  }
}

async function stopSpeaking(): Promise<void> {
  try {
    await api.stopSpeech()
  } catch {
    /* nothing to stop */
  }
  speaking.value = false
}

async function flipDirection(): Promise<void> {
  direction.value = direction.value === 'en-hu' ? 'hu-en' : 'en-hu'
  if (sessionId.value) {
    try {
      await api.setDirection(sessionId.value, direction.value)
    } catch {
      /* the next turn simply keeps the old direction server-side */
    }
  }
}

async function removeSession(id: string): Promise<void> {
  try {
    await api.removeSession(id)
    if (id === sessionId.value) await newSession()
    await loadSessions()
    toast('Session deleted', 'success')
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not delete it', 'error')
  }
}

function hide(): void {
  overlay?.hide()
}

/** Fallback for P when the session has no recorded term yet. */
function headwordOfLastAnswer(): string {
  const last = [...bubbles.value].reverse().find((bubble) => bubble.role === 'assistant')
  const match = last ? /^\*\*(.+?)\*\*/m.exec(last.content) : null
  return match?.[1]?.replace(/\*.*$/, '').trim() ?? ''
}

function focusComposer(): void {
  void nextTick(() => document.querySelector<HTMLTextAreaElement>('.composer__input')?.focus())
}

function scrollToEnd(): void {
  void nextTick(() => {
    const list = document.querySelector('.transcript')
    if (list) list.scrollTop = list.scrollHeight
  })
}

function onKey(event: KeyboardEvent): void {
  const typing = (event.target as HTMLElement | null)?.tagName === 'TEXTAREA'
  if (event.key === 'Escape') {
    event.preventDefault()
    if (busy.value) abort()
    else if (view.value !== 'chat') view.value = 'chat'
    else hide()
    return
  }
  const modifier = event.altKey || event.ctrlKey || event.metaKey
  if (event.key.toLowerCase() === 'p' && (modifier || !typing)) {
    event.preventDefault()
    // Both spellings say the session's word: the words being translated are the
    // ones worth hearing, and every bold word is clickable on its own.
    void speak(term.value || headwordOfLastAnswer())
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    view.value = view.value === 'sessions' ? 'chat' : 'sessions'
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    void newSession()
  }
}

watch(view, (next) => {
  if (next === 'sessions') void loadSessions()
})

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  overlay?.onShown(() => focusComposer())
  await loadStatus()
  if (settings.lastSessionId) await openSession(settings.lastSessionId)
  else focusComposer()
  await loadSessions()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  abort()
  void stopSpeaking()
})
</script>

<template>
  <div class="stage">
    <div class="scrim" @click="hide" />

    <main class="card" role="dialog" aria-label="vocab lookup">
      <header class="head">
        <div class="head__left">
          <strong class="head__title"><span class="head__v">v</span>ocab</strong>
          <button class="pill" :title="`Translate the other way round`" @click="flipDirection">
            {{ directionLabel }}
          </button>
          <span v-if="term" class="head__term">{{ term }}</span>
        </div>
        <nav class="head__right">
          <button
            class="icon-btn"
            :data-active="view === 'sessions'"
            title="Sessions (Ctrl+K)"
            @click="view = view === 'sessions' ? 'chat' : 'sessions'"
          >
            <span aria-hidden="true">≡</span><span class="sr-only">Sessions</span>
          </button>
          <button class="icon-btn" title="New session (Ctrl+N)" @click="newSession">
            <span aria-hidden="true">＋</span><span class="sr-only">New session</span>
          </button>
          <button
            class="icon-btn"
            :data-active="view === 'settings'"
            title="Settings"
            @click="view = view === 'settings' ? 'chat' : 'settings'"
          >
            <span aria-hidden="true">⚙</span><span class="sr-only">Settings</span>
          </button>
          <button class="icon-btn" title="Hide (Esc)" @click="hide">
            <span aria-hidden="true">✕</span><span class="sr-only">Hide</span>
          </button>
        </nav>
      </header>

      <div v-if="busy" class="progress" role="progressbar" aria-label="Look-up in progress" />

      <SessionPanel
        v-if="view === 'sessions'"
        :sessions="sessions"
        :active-id="sessionId"
        @open="openSession"
        @remove="removeSession"
        @new="newSession"
      />

      <SettingsPanel v-else-if="view === 'settings' && status" :status="status" />

      <ChatView
        v-else
        v-model:draft="draft"
        :bubbles="bubbles"
        :busy="busy"
        :speaking="speaking"
        :sessions="sessions"
        @send="send"
        @stop="abort"
        @speak="speak"
        @open="openSession"
      />

      <footer class="foot">
        <span><kbd>↵</kbd> new</span>
        <span><kbd>Ctrl</kbd>+<kbd>↵</kbd> follow-up</span>
        <span><kbd>Alt</kbd>+<kbd>↵</kbd> line break</span>
        <span><kbd>P</kbd> say</span>
        <span v-if="status"><kbd>{{ status.hotkey }}</kbd> toggle</span>
        <span class="foot__grow" />
        <span v-if="status?.tts.available" class="foot__model">{{ status.model }}</span>
      </footer>
    </main>

    <ol class="toasts">
      <li v-for="item in toasts" :key="item.id" :class="['toast', `toast--${item.kind}`]">
        {{ item.message }}
      </li>
    </ol>
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 3vh 3vw;
}

.scrim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, var(--scrim));
}

.card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(60rem, 94vw);
  height: min(46rem, 88vh);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.85);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--line-soft);
}

.head__left,
.head__right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.head__title {
  font-size: 15px;
  letter-spacing: 0.01em;
}

/* The wordmark's first letter carries the accent: the header has one blue
   touch, on the word itself, instead of a glyph standing beside it. */
.head__v {
  color: var(--accent);
}

.head__term {
  overflow: hidden;
  color: var(--dim);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* An indeterminate bar under the header: the look-up is running, and the answer
   itself streams into the transcript below. */
.progress {
  position: relative;
  flex: none;
  height: 2px;
  background: var(--line-soft);
  overflow: hidden;
}

.progress::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 35%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: slide 1.15s ease-in-out infinite;
}

@keyframes slide {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(390%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress::before {
    width: 100%;
    animation: none;
    opacity: 0.6;
  }
}

.foot {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 9px 14px 11px;
  border-top: 1px solid var(--line-soft);
  color: var(--dimmer);
  font-size: 11.5px;
  white-space: nowrap;
}

.foot > span {
  flex: none;
}

.foot__grow {
  flex: 1 1 auto;
  min-width: 0;
}

.foot__model {
  overflow: hidden;
  color: var(--dimmer);
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
}

.toasts {
  position: absolute;
  left: 50%;
  bottom: 5vh;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  transform: translateX(-50%);
}

.toast {
  max-width: 34rem;
  padding: 9px 14px;
  background: #17171d;
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  font-size: 13.5px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.8);
}

.toast--success {
  border-left-color: var(--ok);
}

.toast--error {
  border-left-color: var(--danger);
}
</style>
