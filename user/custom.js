/**
 * antigravity-enhancer · User Custom Runtime Hook (Hot-Reloaded)
 *
 * Executed inside the workbench window with `(ctx)` whenever
 * `user/custom.js` changes or Antigravity reloads.
 *
 * Available on `ctx`:
 *   - ctx.version           Current bundle build version
 *   - ctx.telemetryLayout   'compact' | 'detailed'
 *   - ctx.modules           Active module toggle map
 *   - ctx.dict              Mutable WeakMap i18n dictionary
 *   - ctx.metrics           Latest parsed local session stats payload
 *   - ctx.onCleanup(fn)     Register teardown callback before hot-reload
 */
