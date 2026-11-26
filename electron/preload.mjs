import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only surface the renderer gets: the overlay controls and the backend.
 * No Node, no filesystem, no shell — the main process decides what a call may
 * do, and the API key never crosses this line.
 */

const invoke = (method, payload) => ipcRenderer.invoke(`vocab:${method}`, payload)

const CHAT_EVENT = 'vocab:chat:event'

contextBridge.exposeInMainWorld('overlay', {
  hide: () => ipcRenderer.send('overlay:hide'),
  quit: () => ipcRenderer.send('overlay:quit'),
  setHideOnBlur: (enabled) => ipcRenderer.send('overlay:hideOnBlur', Boolean(enabled)),
  onShown: (handler) => {
    ipcRenderer.on('overlay:shown', () => handler())
  },
  onHidden: (handler) => {
    ipcRenderer.on('overlay:hidden', () => handler())
  },
})

contextBridge.exposeInMainWorld('vocab', {
  invoke,

  /**
   * Starts one streamed turn. Events for this stream carry its id, so two
   * look-ups (or a stale one that is still winding down) never mix.
   * Returns the id needed to cancel it — functions are awkward across the
   * context bridge, so the caller keeps the id and calls chatCancel.
   */
  chatStart(payload, onEvent) {
    const streamId = globalThis.crypto.randomUUID()
    const listener = (_event, message) => {
      if (!message || message.streamId !== streamId) return
      onEvent(message.event)
    }
    ipcRenderer.on(CHAT_EVENT, listener)
    const settle = () => ipcRenderer.removeListener(CHAT_EVENT, listener)
    invoke('chat', { ...payload, streamId })
      .catch((error) => {
        onEvent({
          type: 'error',
          status: 500,
          message: error instanceof Error ? error.message : 'The look-up failed.',
        })
      })
      .finally(settle)
    return streamId
  },

  chatCancel(streamId) {
    ipcRenderer.send('vocab:chat:abort', { streamId })
  },
})
