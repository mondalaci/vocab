<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
  SwitchRoot,
  SwitchThumb,
} from 'reka-ui'
import type { Status } from '@/api'
import { settings } from '@/lib/settings'

const props = defineProps<{ status: Status }>()

const VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe',
  'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib',
  'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird']

const TOGGLES = [
  { key: 'playOnHost', label: 'Speak on this machine', hint: `${props.status.tts.player ?? 'no player'} → the default sink` },
  { key: 'autoSpeak', label: 'Say the word automatically', hint: 'When the answer arrives' },
  { key: 'hideOnBlur', label: 'Hide when it loses focus', hint: 'Coming back means pressing the hotkey again' },
] as const

function setHideOnBlur(): void {
  window.overlay?.setHideOnBlur(settings.hideOnBlur)
}

function quit(): void {
  window.overlay?.quit()
}
</script>

<template>
  <section class="panel scroll">
    <div class="group">
      <label class="group__label" for="voice-select">Voice</label>
      <SelectRoot v-model="settings.voice">
        <SelectTrigger id="voice-select" class="field select">
          <SelectValue>{{ settings.voice || `default (${status.tts.voice})` }}</SelectValue>
          <span aria-hidden="true" class="select__chevron">⌄</span>
        </SelectTrigger>
        <SelectPortal disabled>
          <SelectContent class="select__content" position="popper" :side-offset="6">
            <SelectViewport class="select__viewport">
              <SelectItem class="select__item" value="">
                <SelectItemText>Default ({{ status.tts.voice }})</SelectItemText>
                <SelectItemIndicator class="select__tick">✓</SelectItemIndicator>
              </SelectItem>
              <SelectItem v-for="voice in VOICES" :key="voice" class="select__item" :value="voice">
                <SelectItemText>{{ voice }}</SelectItemText>
                <SelectItemIndicator class="select__tick">✓</SelectItemIndicator>
              </SelectItem>
            </SelectViewport>
          </SelectContent>
        </SelectPortal>
      </SelectRoot>
      <p class="hint">
        <kbd>P</kbd> says the session's word · click any bold word to hear just that word.
      </p>
    </div>

    <div class="group">
      <span class="group__label">Behaviour</span>
      <ul class="toggles">
        <li v-for="toggle in TOGGLES" :key="toggle.key" class="toggles__row">
          <span class="toggles__text">
            <span class="toggles__label">{{ toggle.label }}</span>
            <span class="toggles__hint">{{ toggle.hint }}</span>
          </span>
          <SwitchRoot
            v-model="settings[toggle.key]"
            class="switch"
            @update:model-value="toggle.key === 'hideOnBlur' && setHideOnBlur()"
          >
            <SwitchThumb class="switch__thumb" />
          </SwitchRoot>
        </li>
      </ul>
    </div>

    <div class="group">
      <span class="group__label">Runtime</span>
      <dl class="facts">
        <dt>model</dt>
        <dd>{{ status.model }}</dd>
        <dt>speech</dt>
        <dd>
          {{ status.tts.model }} · {{ status.tts.player ?? 'no player found' }}
          <span v-if="!status.tts.available"> (unavailable)</span>
        </dd>
        <dt>hotkey</dt>
        <dd>{{ status.hotkey }}</dd>
        <dt>database</dt>
        <dd class="facts__path">{{ status.database }}</dd>
        <dt>config</dt>
        <dd class="facts__path">
          {{ status.configFile }}<span v-if="status.usingDefaults"> — missing, defaults in use</span>
        </dd>
        <dt>stored</dt>
        <dd>
          {{ status.counts.sessions }} sessions · {{ status.counts.messages }} turns
        </dd>
      </dl>
      <p v-if="!status.hasApiKey" class="warn">
        No OpenRouter API key in config.mjs — nothing can be looked up or spoken.
      </p>
      <button class="ghost" @click="quit">Quit the overlay</button>
    </div>
  </section>
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 18px 18px;
}

.group {
  padding: 14px 0;
  border-bottom: 1px solid var(--line-soft);
}

.group:last-child {
  border-bottom: 0;
}

.group__label {
  display: block;
  margin-bottom: 8px;
  color: var(--dim);
  font-size: 11.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.select {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 20rem;
}

.select__chevron {
  color: var(--dim);
}

:deep(.select__content) {
  z-index: 60;
  max-height: 40vh;
  overflow: hidden;
  background: var(--card-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.9);
}

:deep(.select__viewport) {
  max-height: 40vh;
  padding: 6px;
  overflow-y: auto;
}

:deep(.select__item) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 9px;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  cursor: pointer;
}

:deep(.select__item[data-highlighted]) {
  background: #1c1c24;
}

:deep(.select__tick) {
  color: var(--accent);
}

.hint {
  margin: 8px 0 0;
  color: var(--dimmer);
  font-size: 12px;
}

.toggles {
  margin: 0;
  padding: 0;
  list-style: none;
}

.toggles__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 0;
}

.toggles__text {
  display: flex;
  flex-direction: column;
}

.toggles__label {
  font-size: 14.5px;
}

.toggles__hint {
  color: var(--dim);
  font-size: 12px;
}

.switch {
  flex: none;
  width: 44px;
  height: 26px;
  background: var(--card-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  transition: background 0.15s ease;
}

.switch[data-state='checked'] {
  background: var(--accent);
  border-color: var(--accent);
}

.switch__thumb {
  display: block;
  width: 20px;
  height: 20px;
  margin-left: 2px;
  background: var(--fg);
  border-radius: 50%;
  transition: transform 0.15s ease;
}

.switch[data-state='checked'] .switch__thumb {
  background: var(--accent-ink);
  transform: translateX(18px);
}

.facts {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: 4px 12px;
  margin: 0;
  font-size: 13px;
}

.facts dt {
  color: var(--dim);
}

.facts dd {
  margin: 0;
  color: var(--fg);
  word-break: break-word;
}

.facts__path {
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11.5px;
  color: var(--dimmer) !important;
}

.warn {
  margin: 10px 0 0;
  color: var(--warn);
  font-size: 13px;
}

.ghost {
  margin-top: 12px;
  min-height: 34px;
  padding: 0 14px;
  color: var(--dim);
  background: var(--card-2);
  border-radius: 9px;
}

.ghost:hover {
  color: var(--fg-strong);
}
</style>
