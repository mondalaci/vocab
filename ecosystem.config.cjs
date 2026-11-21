// pm2 start ecosystem.config.cjs
//
// Two processes: the API the overlay talks to, and the overlay window itself.
//
// The overlay is launched through scripts/overlay.sh rather than the Electron
// binary directly, because this machine exports ELECTRON_RUN_AS_NODE=1 (the pm2
// daemon inherited it too) — with that variable set, Electron runs as plain Node
// and the window never appears.
module.exports = {
  apps: [
    {
      name: 'vocab',
      cwd: __dirname,
      // tsx directly, so there is no npm wrapper between pm2 and the server.
      script: 'node_modules/tsx/dist/cli.mjs',
      args: 'server/index.ts',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 10,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'vocab-overlay',
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
