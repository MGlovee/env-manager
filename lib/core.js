/** Shared helpers: platform facts, subprocess execution, and JSON fetch. */

import { homedir } from 'node:os'

export const IS_WINDOWS = process.platform === 'win32'
export const IS_MAC = process.platform === 'darwin'
export const IS_LINUX = process.platform === 'linux'

export const OS_LABEL = IS_WINDOWS ? 'windows' : IS_MAC ? 'macos' : IS_LINUX ? 'linux' : process.platform

/** Path of the guaranteed shell used to run a command script. */
function shellPath() {
  if (IS_WINDOWS) return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  return '/bin/sh'
}

export function platformInfo() {
  return {
    os: OS_LABEL,
    platform: process.platform,
    arch: process.arch, // x64 | arm64 | ia32 ...
    home: homedir(),
  }
}

/** Run a script through the platform shell and collect stdout/stderr. */
export async function run(ctx, script, opts = {}) {
  const argv = [shellPath()]
  if (IS_WINDOWS) {
    argv.push('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script)
  } else {
    argv.push('-c', script)
  }
  const spec = {
    argv,
    cwd: opts.cwd || homedir(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 32 * 1024 * 1024 },
      stderr: { maxBytes: 32 * 1024 * 1024 },
    },
    graceMs: opts.graceMs ?? 120_000,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  }
  let handle
  try {
    handle = ctx.subprocess.spawn(spec)
  } catch (err) {
    return { ok: false, exitCode: null, stdout: '', stderr: `spawn failed: ${err?.message ?? err}` }
  }
  let outcome
  try {
    outcome = await handle.done
  } catch (err) {
    return { ok: false, exitCode: null, stdout: '', stderr: `spawn error: ${err?.message ?? err}` }
  }
  const stdout = handle.collected?.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected?.stderr?.readFrom(0).text ?? ''
  return { ok: outcome.exitCode === 0, exitCode: outcome.exitCode, signal: outcome.signal, stdout, stderr }
}

/** PowerShell single-quote escaping. */
export function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'"
}

/** POSIX sh single-quote escaping. */
export function shQuote(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'"
}

/** Build a shell snippet that runs an executable with args (stdout/stderr stay separate). */
export function shellCommand(file, args) {
  const quoted = args.map(IS_WINDOWS ? psQuote : shQuote)
  if (IS_WINDOWS) return `& ${psQuote(file)} ${quoted.join(' ')}`
  return `${shQuote(file)} ${quoted.join(' ')}`
}

/** Run a specific executable through the shell and collect merged output. */
export async function runCommand(ctx, file, args, opts = {}) {
  return run(ctx, shellCommand(file, args), opts)
}

/** Fetch JSON with a timeout and a descriptive error. */
export async function fetchJson(url, { timeoutMs = 30_000, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'env-manager/1.0', accept: 'application/json,text/plain,*/*' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const text = await res.text()
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/** Fetch plain text with a timeout. */
export async function fetchText(url, { timeoutMs = 30_000, signal } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'env-manager/1.0', accept: 'text/html,text/plain,*/*' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}
