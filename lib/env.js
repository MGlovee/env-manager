/** Switch environment variables (JAVA_HOME / M2_HOME / NODE_HOME / PYTHON_HOME and PATH). */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, psQuote, IS_WINDOWS, IS_MAC } from './core.js'

const home = os.homedir()

export function toolEnvVar(tool) {
  return { jdk: 'JAVA_HOME', node: 'NODE_HOME', maven: 'M2_HOME', python: 'PYTHON_HOME' }[tool]
}

export function toolBinDir(tool, installDir) {
  if (tool === 'node' || tool === 'python') {
    // Windows keeps the binary at the install root; POSIX keeps it under bin/.
    return IS_WINDOWS ? installDir : path.join(installDir, 'bin')
  }
  return path.join(installDir, 'bin')
}

function windowsSwitch({ homeVar, homeDir, binDir, scope }) {
  const machine = scope === 'machine'
  const hive = machine ? 'LocalMachine' : 'CurrentUser'
  const subkey = machine
    ? 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
    : 'Environment'
  const scopeLiteral = machine ? "'Machine'" : "'User'"
  const lines = [
    `$ErrorActionPreference = 'Stop'`,
    `$homeVar = ${psQuote(homeVar)}`,
    `$home = ${psQuote(homeDir)}`,
    `$bin = ${psQuote(binDir)}`,
    `$hive = [Microsoft.Win32.Registry]::${hive}`,
    `$key = $hive.OpenSubKey(${psQuote(subkey)}, $true)`,
    `if ($null -eq $key) { $key = $hive.CreateSubKey(${psQuote(subkey)}) }`,
    `$oldHome = $key.GetValue($homeVar, $null)`,
    `$oldBin = if ($oldHome) { Join-Path $oldHome 'bin' }`,
    `$path = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)`,
    `$entries = @($path -split ';' | Where-Object { $_ -ne '' })`,
    `$entries = @($entries | Where-Object { $_.TrimEnd('\\') -notin @($bin, $oldHome, $oldBin) })`,
    `$newEntries = @($bin) + $entries`,
    `$key.SetValue('Path', ($newEntries -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)`,
    `$key.SetValue($homeVar, $home, [Microsoft.Win32.RegistryValueKind]::String)`,
    `$key.Close()`,
    `[Environment]::SetEnvironmentVariable($homeVar, $home, ${scopeLiteral})`,
    `Write-Output 'OK'`,
  ]
  return lines.join('; ')
}

function posixProfileFile() {
  const candidates = ['.zshrc', '.bash_profile', '.bashrc', '.profile']
  for (const f of candidates) {
    const p = path.join(home, f)
    if (fs.existsSync(p)) return p
  }
  return path.join(home, '.zshrc')
}

function posixSwitch({ homeVar, homeDir, binDir, tool }) {
  const profile = posixProfileFile()
  const marker = `# >>> env-manager ${tool} >>>`
  const end = `# <<< env-manager ${tool} <<<`
  const block = [
    marker,
    `export ${homeVar}="${homeDir}"`,
    `export PATH="${binDir}:$PATH"`,
    end,
  ].join('\n')
  let text = fs.existsSync(profile) ? fs.readFileSync(profile, 'utf8') : ''
  const re = new RegExp(`${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`)
  if (re.test(text)) text = text.replace(re, '')
  text = text.replace(/\n*$/, '\n\n') + block + '\n'
  fs.writeFileSync(profile, text, 'utf8')
  return profile
}

/** Point the tool's HOME variable and PATH at an installed directory. */
export async function switchTool(ctx, tool, installDir, opts = {}) {
  const scope = opts.scope === 'machine' ? 'machine' : 'user'
  const signal = opts.signal
  const homeVar = toolEnvVar(tool)
  const binDir = toolBinDir(tool, installDir)

  if (!fs.existsSync(installDir)) {
    throw new Error(`Install directory does not exist: ${installDir}`)
  }

  if (IS_WINDOWS) {
    const r = await run(ctx, windowsSwitch({ homeVar, homeDir: installDir, binDir, scope }), { signal, graceMs: 30_000 })
    if (!r.ok) {
      throw new Error(`Failed to switch ${tool} on Windows: ${r.stdout || r.stderr}`.trim())
    }
    return {
      platform: 'windows',
      scope,
      changed: { [homeVar]: installDir, PATH_prepend: binDir },
      note: 'New variables apply to processes started after the change; reopen terminals for them to take effect.',
    }
  }

  const profile = posixSwitch({ homeVar, homeDir: installDir, binDir, tool })
  return {
    platform: IS_MAC ? 'macos' : 'linux',
    scope: 'shell-profile',
    profile,
    changed: { [homeVar]: installDir, PATH_prepend: binDir },
    note: `Updated ${profile}; run \`source ${profile}\` or open a new terminal.`,
  }
}
