// pm2 start ecosystem.config.cjs
//
// One process: the Electron app is the whole program now. It owns the window,
// the SQLite database, the OpenRouter streams and speech; there is no API server
// and no port. `dist/` (renderer) and `dist-electron/main.mjs` (main process)
// must be built first — `npm run build`.
//
// It is launched through scripts/overlay.sh rather than the Electron binary
// directly, because this machine exports ELECTRON_RUN_AS_NODE=1 (the pm2 daemon
// inherited it too) — with that variable set, Electron runs as plain Node and the
// window never appears.
module.exports = {
  apps: [
    {
      name: 'vocab',
      cwd: __dirname,
      script: 'scripts/overlay.sh',
      interpreter: 'bash',
      autorestart: true,
      max_restarts: 10,
      // Hiding the window is not quitting; only a real exit should restart.
      stop_exit_codes: [0],
      env: { NODE_ENV: 'production' },
    },
  ],
}
