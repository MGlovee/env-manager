/** Download a runtime release, unpack it into a directory, and optionally switch to it. */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { run, psQuote, shQuote, IS_WINDOWS } from './core.js'
import { resolveDownload } from './catalog.js'
import { switchTool } from './env.js'

const q = IS_WINDOWS ? psQuote : shQuote

async function downloadFile(url, dest, signal, onProgress) {
  const res = await fetch(url, { signal, headers: { 'user-agent': 'env-manager/1.0' } })
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`)
  const total = parseInt(res.headers.get('content-length') || '0', 10)
  const tmp = dest + '.part'
  const write = fs.createWriteStream(tmp)
  let received = 0
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      if (onProgress) onProgress(total > 0 ? received / total : 0, received, total)
      cb(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body), meter, write)
  fs.renameSync(tmp, dest)
  return dest
}

function downloadRoot(opts) {
  return opts.root || path.join(os.homedir(), '.envman')
}

function dirSegment(tool, dl) {
  if (tool === 'jdk') return `jdk-${dl.version.replace(/^JDK\s+/, '')}`
  return dl.version
}

async function extract(ctx, archive, dest, kind, signal) {
  let script
  if (kind === 'zip') {
    script = IS_WINDOWS
      ? `Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(dest)} -Force`
      : `unzip -q ${shQuote(archive)} -d ${shQuote(dest)}`
  } else if (kind === 'tar.gz' || kind === 'tgz') {
    script = `tar -xzf ${q(archive)} -C ${q(dest)}`
  } else if (kind === 'tar.xz') {
    script = `tar -xJf ${q(archive)} -C ${q(dest)}`
  } else {
    throw new Error(`Unsupported archive kind: ${kind}`)
  }
  const r = await run(ctx, script, { signal, graceMs: 600_000 })
  if (!r.ok) throw new Error(`Extraction failed: ${(r.stdout || r.stderr || '').trim()}`)
}

function finalizeExtraction(staging, finalDir) {
  const entries = fs.readdirSync(staging)
  if (entries.length === 1) {
    const single = path.join(staging, entries[0])
    if (fs.statSync(single).isDirectory()) {
      fs.renameSync(single, finalDir)
      fs.rmSync(staging, { recursive: true, force: true })
      return finalDir
    }
  }
  fs.renameSync(staging, finalDir)
  return finalDir
}

async function installPythonWindows(ctx, exe, finalDir, signal) {
  const script = [
    `$exe = ${psQuote(exe)}`,
    `$dir = ${psQuote(finalDir)}`,
    `$args = @('/quiet','InstallAllUsers=0','PrependPath=0','Include_launcher=0','Include_test=0','Include_doc=0',("TargetDir=" + $dir))`,
    `$p = Start-Process -FilePath $exe -ArgumentList $args -Wait -PassThru`,
    `Write-Output ('EXIT=' + $p.ExitCode)`,
  ].join('; ')
  const r = await run(ctx, script, { signal, graceMs: 600_000 })
  const m = (r.stdout || '').match(/EXIT=(\d+)/)
  const exitCode = m ? parseInt(m[1], 10) : null
  if (!r.ok || exitCode !== 0) {
    throw new Error(`Python installer failed (exit ${exitCode ?? '?'}): ${(r.stdout || r.stderr || '').trim()}`)
  }
}

export async function installTool(ctx, tool, version, opts = {}) {
  const signal = opts.signal
  const onProgress = opts.onProgress || (() => {})
  const dl = await resolveDownload(ctx, tool, version, signal)
  const root = downloadRoot(opts)
  const finalDir = opts.targetDir || path.join(root, tool, dirSegment(tool, dl))

  if (fs.existsSync(finalDir) && !opts.force) {
    throw new Error(`Target directory already exists: ${finalDir} (pass force to overwrite)`)
  }
  fs.mkdirSync(path.dirname(finalDir), { recursive: true })

  const archive = path.join(root, tool, `.download-${path.basename(dl.fileName)}`)
  fs.mkdirSync(path.dirname(archive), { recursive: true })
  onProgress(0, '准备下载…')
  await downloadFile(dl.url, archive, signal, (progress, received, total) => {
    if (total > 0) {
      onProgress(Math.min(progress, 0.99), '下载中 ' + Math.round(progress * 100) + '%')
    } else {
      onProgress(0, '下载中 ' + (received / 1024 / 1024).toFixed(1) + ' MB（总大小未知）')
    }
  })
  onProgress(1, '解压 / 安装中…')

  let installedDir = finalDir
  if (dl.kind === 'exe') {
    // Windows Python: silent per-user install straight into finalDir.
    fs.mkdirSync(finalDir, { recursive: true })
    await installPythonWindows(ctx, archive, finalDir, signal)
    fs.rmSync(archive, { force: true })
  } else if (dl.kind === 'pkg') {
    // macOS Python installer: keep the package for a manual install.
    const pkgDest = finalDir + path.extname(dl.fileName)
    fs.mkdirSync(finalDir, { recursive: true })
    fs.renameSync(archive, path.join(finalDir, dl.fileName))
    installedDir = finalDir
  } else {
    const staging = path.join(root, tool, `.staging-${path.basename(dl.fileName)}-${Date.now()}`)
    fs.mkdirSync(staging, { recursive: true })
    try {
      await extract(ctx, archive, staging, dl.kind, signal)
      installedDir = finalizeExtraction(staging, finalDir)
    } finally {
      fs.rmSync(archive, { force: true })
    }
  }

  let switched = null
  if (opts.switch) {
    switched = await switchTool(ctx, tool, installedDir, { scope: opts.scope, signal })
  }

  return {
    tool,
    requestedVersion: version,
    resolvedVersion: dl.version,
    source: dl.url,
    installedDir,
    switched,
  }
}
