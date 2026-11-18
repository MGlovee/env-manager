/** List downloadable versions and resolve a download URL for the current platform. */

import { fetchJson, fetchText, IS_WINDOWS, IS_MAC, IS_LINUX } from './core.js'

const ARCH = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64'

/** Compare two dotted numeric versions; returns negative, zero, or positive. */
export function compareVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

function nodeFiles() {
  if (IS_WINDOWS) return { asset: ARCH === 'arm64' ? 'win-arm64' : 'win-x64', ext: 'zip', kind: 'zip' }
  if (IS_MAC) return { asset: `darwin-${ARCH}`, ext: 'tar.gz', kind: 'tar.gz' }
  return { asset: ARCH === 'arm64' ? 'linux-arm64' : 'linux-x64', ext: 'tar.xz', kind: 'tar.xz' }
}

async function listNode(ctx, { limit = 20, filter, signal }) {
  const data = await fetchJson('https://nodejs.org/dist/index.json', { signal })
  let list = data
    .filter((e) => /^v\d+\.\d+\.\d+$/.test(e.version))
    .map((e) => ({
      version: e.version,
      lts: e.lts === false ? null : e.lts,
      date: e.date,
    }))
  if (filter === 'lts') list = list.filter((e) => e.lts)
  else if (filter === 'stable') list = list.filter((e) => !e.lts)
  else if (filter) {
    const q = filter.toLowerCase()
    list = list.filter((e) => e.version.toLowerCase().includes(q) || (e.lts && e.lts.toLowerCase() === q))
  }
  return list.slice(0, limit)
}

async function listMaven(ctx, { limit = 20, filter, signal }) {
  const html = await fetchText('https://dlcdn.apache.org/maven/maven-3/', { signal })
  const versions = [...html.matchAll(/href="(\d+\.\d+\.\d+)\//g)].map((m) => m[1])
  let list = [...new Set(versions)].sort((a, b) => compareVersion(b, a)).map((v) => ({ version: v, lts: null, date: null }))
  if (filter) list = list.filter((e) => e.version.includes(filter))
  return list.slice(0, limit)
}

async function listJdk(ctx, { limit = 20, filter, signal }) {
  const info = await fetchJson('https://api.adoptium.net/v3/info/available_releases', { signal })
  const lts = new Set(info.available_lts_releases || [])
  const releases = filter === 'lts' ? (info.available_lts_releases || []) : (info.available_releases || [])
  let list = releases
    .map((n) => ({ version: String(n), lts: lts.has(n) ? 'LTS' : null, date: null }))
    .sort((a, b) => compareVersion(b.version, a.version))
  if (filter && filter !== 'lts') list = list.filter((e) => e.version.startsWith(String(filter)))
  return list.slice(0, limit)
}

async function listPython(ctx, { limit = 20, filter, signal }) {
  const data = await fetchJson('https://www.python.org/api/v2/downloads/release/?page_size=500', { signal })
  let list = data
    .filter((e) => e.is_published && !e.pre_release)
    .map((e) => ({ version: e.name.replace(/^Python\s+/, ''), lts: null, date: e.release_date, show: e.show_on_download_page }))
    .filter((e) => /^\d+\.\d+\.\d+$/.test(e.version) && compareVersion(e.version, '3.8.0') >= 0)
  list.sort((a, b) => compareVersion(b.version, a.version))
  if (filter === 'stable') list = list.filter((e) => e.show !== false)
  else if (filter) list = list.filter((e) => e.version.startsWith(filter))
  return list.slice(0, limit)
}

export async function listVersions(ctx, tool, opts = {}) {
  const { limit = 20, filter } = opts
  const signal = opts.signal
  switch (tool) {
    case 'node': return listNode(ctx, { limit, filter, signal })
    case 'maven': return listMaven(ctx, { limit, filter, signal })
    case 'jdk': return listJdk(ctx, { limit, filter, signal })
    case 'python': return listPython(ctx, { limit, filter, signal })
    default: throw new Error(`Unknown tool: ${tool}`)
  }
}

/** Resolve a concrete download URL for an exact version on this platform. */
export async function resolveDownload(ctx, tool, version, signal) {
  if (tool === 'node') {
    const v = String(version).replace(/^v/, '')
    const { asset, ext, kind } = nodeFiles()
    return { version: `v${v}`, url: `https://nodejs.org/dist/v${v}/node-v${v}-${asset}.${ext}`, fileName: `node-v${v}-${asset}.${ext}`, kind }
  }
  if (tool === 'maven') {
    const v = String(version)
    const kind = IS_WINDOWS ? 'zip' : 'tar.gz'
    return { version: v, url: `https://dlcdn.apache.org/maven/maven-3/${v}/binaries/apache-maven-${v}-bin.${kind}`, fileName: `apache-maven-${v}-bin.${kind}`, kind }
  }
  if (tool === 'jdk') {
    const feature = String(version)
    const os = IS_WINDOWS ? 'windows' : IS_MAC ? 'mac' : 'linux'
    const arch = ARCH === 'arm64' ? 'aarch64' : 'x64'
    const qs = `architecture=${arch}&image_type=jdk&os=${os}&vendor=eclipse`
    const assets = await fetchJson(`https://api.adoptium.net/v3/assets/latest/${feature}/hotspot?${qs}`, { signal })
    const bin = assets?.[0]?.binary
    if (!bin?.package?.link) throw new Error(`No Temurin JDK ${feature} build found for ${os}/${arch}`)
    const kind = bin.package.name.endsWith('.zip') ? 'zip' : 'tar.gz'
    return { version: `JDK ${feature}`, url: bin.package.link, fileName: bin.package.name, kind }
  }
  if (tool === 'python') {
    const v = String(version)
    if (IS_WINDOWS) {
      const arch = ARCH === 'arm64' ? 'arm64' : 'amd64'
      return { version: v, url: `https://www.python.org/ftp/python/${v}/python-${v}-${arch}.exe`, fileName: `python-${v}-${arch}.exe`, kind: 'exe' }
    }
    if (IS_MAC) {
      return { version: v, url: `https://www.python.org/ftp/python/${v}/python-${v}-macos11.pkg`, fileName: `python-${v}-macos11.pkg`, kind: 'pkg' }
    }
    return { version: v, url: `https://www.python.org/ftp/python/${v}/Python-${v}.tgz`, fileName: `Python-${v}.tgz`, kind: 'tgz' }
  }
  throw new Error(`Unknown tool: ${tool}`)
}
