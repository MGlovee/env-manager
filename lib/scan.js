/** Scan installed runtimes and the environment variables that select them. */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runCommand, IS_WINDOWS, platformInfo } from './core.js'

const home = os.homedir()

export const TOOL_LABELS = {
  jdk: 'JDK (Java)',
  node: 'Node.js',
  maven: 'Maven',
  python: 'Python',
}

const ENV_VARS = {
  jdk: ['JAVA_HOME'],
  node: ['NODE_HOME', 'NVM_HOME', 'NVM_SYMLINK'],
  maven: ['M2_HOME', 'MAVEN_HOME'],
  python: ['PYTHON_HOME'],
}

/** Directories that are themselves an install. */
function singleRoots() {
  if (IS_WINDOWS) {
    return {
      jdk: [],
      node: ['C:\\Program Files\\nodejs', path.join(process.env.LOCALAPPDATA || '', 'Volta')],
      maven: [],
      python: [
        path.join(process.env.USERPROFILE || home, 'miniconda3'),
        path.join(process.env.USERPROFILE || home, 'anaconda3'),
        'C:\\ProgramData\\Anaconda3',
        'C:\\ProgramData\\miniconda3',
      ],
    }
  }
  return {
    jdk: ['/Library/Java/JavaVirtualMachines', '/usr/lib/jvm'],
    node: [],
    maven: [],
    python: [path.join(home, 'miniconda3'), path.join(home, 'anaconda3'), '/opt/homebrew/Cellar/python'],
  }
}

/** Directories that contain one or more versioned installs. */
function collectionRoots() {
  if (IS_WINDOWS) {
    return {
      jdk: [
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Amazon Corretto',
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Zulu',
        path.join(home, '.jdks'),
      ],
      node: [
        path.join(home, 'AppData', 'Roaming', 'nvm'),
        path.join(home, 'scoop', 'apps'),
      ],
      maven: [
        'C:\\Program Files\\Apache',
        'C:\\Program Files\\apache-maven',
        path.join(home, 'scoop', 'apps'),
      ],
      python: [
        path.join(home, 'AppData', 'Local', 'Programs', 'Python'),
        'C:\\Python',
        path.join(home, 'scoop', 'apps'),
      ],
    }
  }
  return {
    jdk: [
      path.join(home, '.sdkman', 'candidates', 'java'),
      path.join(home, '.jdks'),
      '/opt/homebrew/opt',
      '/Library/Java/JavaVirtualMachines',
      path.join(home, 'Library/Java/JavaVirtualMachines'),
    ],
    node: [
      path.join(home, '.nvm', 'versions', 'node'),
      '/opt/homebrew/opt',
      path.join(home, 'sdkman', 'candidates', 'node'),
    ],
    maven: [
      path.join(home, '.sdkman', 'candidates', 'maven'),
      '/opt/homebrew/opt',
    ],
    python: [
      path.join(home, '.pyenv', 'versions'),
      path.join(home, 'miniconda3', 'envs'),
      path.join(home, 'anaconda3', 'envs'),
    ],
  }
}

function findBinary(dir, tool) {
  const candidates =
    tool === 'jdk' ? (IS_WINDOWS ? ['bin/java.exe'] : ['bin/java']) :
    tool === 'node' ? (IS_WINDOWS ? ['node.exe'] : ['bin/node']) :
    tool === 'maven' ? (IS_WINDOWS ? ['bin/mvn.cmd', 'bin/mvn.bat'] : ['bin/mvn']) :
    IS_WINDOWS ? ['python.exe'] : ['bin/python3', 'bin/python']
  for (const rel of candidates) {
    const p = path.join(dir, rel)
    if (fs.existsSync(p)) return p
  }
  return null
}

function versionFromDirName(dir, tool) {
  const base = path.basename(dir).toLowerCase()
  if (tool === 'jdk') {
    const m = base.match(/(?:jdk|temurin|corretto|zulu)[^0-9]*(\d+(?:\.\d+){0,2})/)
    if (m) return m[1]
  }
  if (tool === 'node') {
    const m = base.match(/v?(\d+\.\d+\.\d+)/)
    if (m) return m[1]
  }
  if (tool === 'maven') {
    const m = base.match(/(\d+\.\d+\.\d+)/)
    if (m) return m[1]
  }
  if (tool === 'python') {
    const m = base.match(/python[^0-9]*(\d+\.\d+(?:\.\d+)?)/)
    if (m) return m[1]
  }
  return null
}

async function detectVersion(ctx, dir, tool, signal) {
  // JDK: prefer the release file, it is exact and cheap.
  if (tool === 'jdk') {
    const release = path.join(dir, 'release')
    if (fs.existsSync(release)) {
      const text = fs.readFileSync(release, 'utf8')
      const m = text.match(/JAVA_VERSION="([^"]+)"/)
      if (m) return m[1]
    }
  }
  const bin = findBinary(dir, tool)
  if (!bin) return null
  const args = tool === 'jdk' ? ['-version'] : tool === 'node' ? ['-v'] : tool === 'maven' ? ['-v'] : ['--version']
  const r = await runCommand(ctx, bin, args, { signal, graceMs: 20_000 })
  if (!r.ok) return null
  return firstLine(r.stdout || r.stderr) || null
}

function firstLine(s) {
  const line = String(s || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  return line || ''
}

async function scanDirs(ctx, tool, signal) {
  const seen = new Set()
  const installs = []
  const push = async (dir) => {
    if (!dir) return
    const abs = path.resolve(dir)
    if (!fs.existsSync(abs) || seen.has(abs.toLowerCase())) return
    seen.add(abs.toLowerCase())
    const version = await detectVersion(ctx, abs, tool, signal)
    installs.push({ dir: abs, version: version || versionFromDirName(abs, tool), source: 'directory' })
  }
  for (const root of collectionRoots()[tool]) {
    if (!root || !fs.existsSync(root)) continue
    let entries = []
    try { entries = fs.readdirSync(root) } catch { continue }
    for (const e of entries) {
      const sub = path.join(root, e)
      let st = null
      try { st = fs.statSync(sub) } catch { continue }
      if (st.isDirectory()) await push(sub)
    }
  }
  for (const root of singleRoots()[tool]) await push(root)
  return installs
}

/** Split the merged PATH environment variable into its directories. */
function mergedPathDirs(env) {
  if (IS_WINDOWS) {
    const machine = (env.PATH && env.PATH.machine) || ''
    const user = (env.PATH && env.PATH.user) || ''
    return (machine + ';' + user).split(';').map((s) => s.trim()).filter(Boolean)
  }
  return String(env.PATH || '').split(':').filter(Boolean)
}

/** If a PATH directory contains this tool's executable, return its install dir. */
function toolBinaryInDir(dir, tool) {
  const names =
    tool === 'jdk' ? ['java.exe'] :
    tool === 'node' ? ['node.exe'] :
    tool === 'maven' ? ['mvn.cmd', 'mvn.bat'] :
    ['python.exe']
  for (const name of names) {
    const p = path.join(dir, name)
    if (!fs.existsSync(p)) continue
    let installDir = dir
    // For jdk/maven the executable lives under <home>/bin.
    if ((tool === 'jdk' || tool === 'maven') && path.basename(dir).toLowerCase() === 'bin') {
      installDir = path.dirname(dir)
    }
    return { binPath: p, installDir }
  }
  return null
}

/** Scan every PATH directory for the tool's executable. */
async function scanPathDirs(ctx, tool, pathDirs, signal) {
  const installs = []
  for (const dir of pathDirs) {
    if (!dir || !fs.existsSync(dir)) continue
    const found = toolBinaryInDir(dir, tool)
    if (!found) continue
    const abs = path.resolve(found.installDir)
    const version = await detectVersion(ctx, abs, tool, signal)
    installs.push({ dir: abs, version: version || versionFromDirName(abs, tool), source: 'PATH' })
  }
  return installs
}

async function readEnvWindows(ctx, signal) {
  // Single-line, single-quoted so no embedded double quotes reach the spawn argv.
  const script =
    "$names = 'JAVA_HOME','M2_HOME','MAVEN_HOME','NODE_HOME','NVM_HOME','NVM_SYMLINK','PYTHON_HOME'; " +
    '$o = [ordered]@{}; ' +
    "foreach ($n in $names) { $o[$n] = @{ user = [Environment]::GetEnvironmentVariable($n,'User'); machine = [Environment]::GetEnvironmentVariable($n,'Machine') } }; " +
    "$o['PATH'] = @{ user = [Environment]::GetEnvironmentVariable('Path','User'); machine = [Environment]::GetEnvironmentVariable('Path','Machine') }; " +
    '$o | ConvertTo-Json -Compress -Depth 4'
  const r = await run(ctx, script, { signal, graceMs: 20_000 })
  if (!r.ok) return {}
  try { return JSON.parse(r.stdout.trim()) } catch { return {} }
}

async function readEnvPosix(ctx, signal) {
  const vars = {}
  for (const n of ['JAVA_HOME', 'M2_HOME', 'MAVEN_HOME', 'NODE_HOME', 'PYTHON_HOME', 'PATH']) {
    const r = await run(ctx, `printf '%s' "$${n}"`, { signal, graceMs: 10_000 })
    vars[n] = r.stdout.trim() || null
  }
  const profileFiles = ['.zshrc', '.bash_profile', '.bashrc', '.profile'].map((f) => path.join(home, f))
  const profile = []
  for (const f of profileFiles) {
    if (!fs.existsSync(f)) continue
    const text = fs.readFileSync(f, 'utf8')
    const exports = text.split(/\r?\n/).filter((l) => /^\s*export\s+(JAVA_HOME|M2_HOME|MAVEN_HOME|NODE_HOME|PYTHON_HOME|PATH)/.test(l))
    if (exports.length) profile.push({ file: f, lines: exports.map((l) => l.trim()) })
  }
  return { ...vars, profile }
}

async function activeTool(ctx, tool, signal) {
  const probes = tool === 'python' ? ['py', 'python3', 'python'] : tool === 'jdk' ? ['java'] : tool === 'node' ? ['node'] : ['mvn']
  const args = tool === 'jdk' ? ['-version'] : tool === 'node' ? ['-v'] : tool === 'maven' ? ['-v'] : ['--version']
  for (const name of probes) {
    const r = await runCommand(ctx, name, args, { signal, graceMs: 20_000 })
    if (r.ok) {
      const out = (r.stdout || r.stderr || '').trim()
      if (out) return { command: name, version: firstLine(out), output: out }
    }
  }
  return { command: probes[0], version: null, output: null }
}

export async function scanEnvironment(ctx, opts = {}) {
  const tools = opts.tools && opts.tools.length ? opts.tools : ['jdk', 'node', 'maven', 'python']
  const signal = opts.signal
  const env = IS_WINDOWS ? await readEnvWindows(ctx, signal) : await readEnvPosix(ctx, signal)
  const pathDirs = mergedPathDirs(env)

  const valueOf = (v) => {
    if (v && typeof v === 'object' && ('user' in v || 'machine' in v)) {
      return v.user || v.machine || null
    }
    return v || null
  }

  const result = { platform: platformInfo(), tools: {} }
  for (const tool of tools) {
    const dirInstalls = await scanDirs(ctx, tool, signal)
    const pathInstalls = await scanPathDirs(ctx, tool, pathDirs, signal)

    // HOME-variable installs (JAVA_HOME / M2_HOME / NODE_HOME / PYTHON_HOME).
    const homeInstalls = []
    for (const v of ENV_VARS[tool]) {
      const val = valueOf(env[v])
      if (val && fs.existsSync(val)) {
        const abs = path.resolve(val)
        const version = await detectVersion(ctx, abs, tool, signal)
        homeInstalls.push({ dir: abs, version: version || versionFromDirName(abs, tool), source: 'env' })
      }
    }

    // Merge (PATH first, then env, then hard-coded dirs), deduplicated by dir.
    const seen = new Set()
    const installs = []
    for (const it of [...pathInstalls, ...homeInstalls, ...dirInstalls]) {
      const key = it.dir.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      installs.push(it)
    }

    // Active: the first PATH match wins; fall back to running the command.
    let active
    if (pathInstalls.length && pathInstalls[0].version) {
      active = { command: tool, version: pathInstalls[0].version, output: null }
    } else {
      active = await activeTool(ctx, tool, signal)
    }

    const envVars = {}
    let homeVariable = null
    for (const v of ENV_VARS[tool]) {
      const value = valueOf(env[v])
      if (value != null) envVars[v] = value
      if (!homeVariable && value) homeVariable = v
    }
    result.tools[tool] = {
      label: TOOL_LABELS[tool],
      envVars,
      homeVariable,
      installs,
      active,
    }
  }
  result.env = env
  return result
}
