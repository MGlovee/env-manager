/** Host plugin: runtime version-manager agent tools + slash commands. */

import { scanEnvironment } from './lib/scan.js'
import { listVersions } from './lib/catalog.js'
import { installTool } from './lib/install.js'
import { switchTool } from './lib/env.js'
import { recommendVersions } from './lib/recommend.js'
import { configureMaven } from './lib/maven.js'

export const name = 'env-manager'
export const inject = ['tools', 'subprocess', 'commands']

const TOOL_ENUM = ['jdk', 'node', 'maven', 'python']
const output = { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] }

const json = (data) => ({ kind: 'success', text: JSON.stringify(data) })
const fail = (error) => ({ kind: 'error', text: error instanceof Error ? error.message : String(error) })

async function resolveExact(ctx, tool, version, signal) {
  if (!['latest', 'lts', 'stable'].includes(version)) return version
  const ltsAware = tool === 'node' || tool === 'jdk'
  const filter = version === 'lts' && ltsAware ? 'lts' : undefined
  const list = await listVersions(ctx, tool, { limit: 5, filter, signal })
  if (!list.length) throw new Error(`No ${version} release found for ${tool}`)
  return list[0].version
}

export function apply(ctx) {
  const register = (definition) => { ctx.effect(() => ctx.tools.register(definition)) }

  register({
    name: 'env_scan',
    description:
      'Scan the local machine for installed JDK, Node.js, Maven, and Python runtimes: their directories, versions, which one is active on PATH, and the environment variables (JAVA_HOME, M2_HOME, NODE_HOME, PYTHON_HOME, PATH) that select them.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { tools: { type: 'array', description: 'Optional subset to scan. Omit to scan all four.', items: { type: 'string', enum: TOOL_ENUM } } },
    },
    output,
    async execute(args, exec) { return scanEnvironment(ctx, { tools: args.tools, signal: exec.signal }) },
  })

  register({
    name: 'env_versions',
    description:
      'List versions of a runtime that can be downloaded, for the current operating system and architecture, from official sources (Adoptium for JDK, nodejs.org for Node.js, apache.org for Maven, python.org for Python).',
    parameters: {
      type: 'object', additionalProperties: false, required: ['tool'],
      properties: {
        tool: { type: 'string', enum: TOOL_ENUM, description: 'Which runtime to list.' },
        limit: { type: 'integer', description: 'Maximum number of versions to return. Default 20.' },
        filter: { type: 'string', description: "Optional filter: 'lts' (LTS only), 'stable', or a version prefix such as '17' or '3.12'." },
      },
    },
    output,
    async execute(args, exec) {
      const versions = await listVersions(ctx, args.tool, { limit: args.limit || 20, filter: args.filter, signal: exec.signal })
      return { tool: args.tool, count: versions.length, versions }
    },
  })

  register({
    name: 'env_install',
    description:
      'Download a runtime version and unpack it into a directory (default ~/.envman/<tool>/<version>), then optionally switch the environment to it. Accepts an exact version or the keywords latest/lts/stable. Detects Windows, macOS, or Linux automatically.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['tool', 'version'],
      properties: {
        tool: { type: 'string', enum: TOOL_ENUM, description: 'Which runtime to download.' },
        version: { type: 'string', description: "Exact version (e.g. '21', 'v20.11.1', '3.9.6', '3.12.2') or 'latest' / 'lts'." },
        targetDir: { type: 'string', description: 'Directory to install into. Defaults to ~/.envman/<tool>/<version>.' },
        root: { type: 'string', description: 'Base download directory. Defaults to ~/.envman.' },
        switch: { type: 'boolean', description: 'After installing, point the HOME variable and PATH at the new version. Default false.' },
        scope: { type: 'string', enum: ['user', 'machine'], description: "Environment scope for switch. 'machine' needs admin rights. Default 'user'." },
        force: { type: 'boolean', description: 'Overwrite the target directory if it already exists. Default false.' },
      },
    },
    output,
    async execute(args, exec) {
      const version = await resolveExact(ctx, args.tool, args.version, exec.signal)
      return installTool(ctx, args.tool, version, {
        targetDir: args.targetDir, root: args.root, switch: args.switch === true,
        scope: args.scope, force: args.force === true, signal: exec.signal,
      })
    },
  })

  register({
    name: 'env_switch',
    description:
      'Point JAVA_HOME / M2_HOME / NODE_HOME / PYTHON_HOME and PATH at an already-installed directory. On Windows it writes the user (or machine) environment and updates PATH without truncating long paths; on macOS/Linux it edits the shell profile.',
    parameters: {
      type: 'object', additionalProperties: false, required: ['tool', 'installDir'],
      properties: {
        tool: { type: 'string', enum: TOOL_ENUM, description: 'Which runtime to switch.' },
        installDir: { type: 'string', description: 'Absolute path of the installed runtime directory.' },
        scope: { type: 'string', enum: ['user', 'machine'], description: "Windows only. 'machine' needs admin rights. Default 'user'." },
      },
    },
    output,
    async execute(args, exec) { return switchTool(ctx, args.tool, args.installDir, { scope: args.scope, signal: exec.signal }) },
  })

  register({
    name: 'env_recommend',
    description: 'Return recommended stable versions for JDK, Node.js, Maven, and Python, with a short rationale for each.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output,
    async execute() { return recommendVersions() },
  })

  register({
    name: 'maven_config',
    description:
      'Generate or update the Maven settings.xml (default ~/.m2/settings.xml) in one step: switch the central mirror to Aliyun (or Tencent / Huawei), add matching repositories, and set the local repository path. An existing file is backed up before overwrite.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        mirror: { type: 'string', enum: ['aliyun', 'tencent', 'huawei', 'none'], description: "Mirror to configure. Default 'aliyun'." },
        localRepo: { type: 'string', description: 'Local repository directory. Defaults to ~/.m2/repository.' },
        settingsPath: { type: 'string', description: 'settings.xml path. Defaults to ~/.m2/settings.xml.' },
        overwrite: { type: 'boolean', description: 'Replace an existing settings.xml (a backup is kept). Default true.' },
      },
    },
    output,
    async execute(args) {
      return configureMaven({ mirror: args.mirror, localRepo: args.localRepo, settingsPath: args.settingsPath, overwrite: args.overwrite !== false })
    },
  })

  // ---- Slash commands (the Web UI calls these through ctx.remote.commands) ----

  const installTasks = new Map()

  const commands = [
    {
      name: 'env-scan',
      description: 'Scan installed JDK/Node.js/Maven/Python and environment variables.',
      async handler(inv) {
        try { return json(await scanEnvironment(ctx, { signal: inv.signal })) } catch (e) { return fail(e) }
      },
    },
    {
      name: 'env-versions',
      description: 'List downloadable versions: /env-versions <jdk|node|maven|python> [limit] [filter].',
      async handler(inv) {
        try {
          const [tool, limit, ...filterParts] = inv.rawInput.trim().split(/\s+/).filter(Boolean)
          if (!tool) return fail(new Error('usage: /env-versions <tool> [limit] [filter]'))
          const versions = await listVersions(ctx, tool, { limit: limit ? parseInt(limit, 10) : 20, filter: filterParts.join(' '), signal: inv.signal })
          return json({ tool, count: versions.length, versions })
        } catch (e) { return fail(e) }
      },
    },
    {
      name: 'env-install',
      description: 'Download and install: /env-install <tool> <version> [--switch] [--dir <path>]. Returns a task id; poll /env-status <id> for progress.',
      handler(inv) {
        try {
          const raw = inv.rawInput.trim()
          const switchIt = /\s--switch(?:\s|$)/u.test(raw)
          const dirMatch = raw.match(/\s--dir\s+(.+)$/u)
          const targetDir = dirMatch ? dirMatch[1].trim() : undefined
          const rest = raw.replace(/\s--switch(?:\s|$)/u, ' ').replace(/\s--dir\s+.+$/u, ' ').trim()
          const [tool, version] = rest.split(/\s+/).filter(Boolean)
          if (!tool || !version) return fail(new Error('usage: /env-install <tool> <version> [--switch] [--dir <path>]'))

          const taskId = 'install-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
          installTasks.set(taskId, { status: 'running', progress: 0, message: '准备中', result: null, error: null })
          void (async () => {
            try {
              const resolved = await resolveExact(ctx, tool, version, undefined)
              const result = await installTool(ctx, tool, resolved, {
                switch: switchIt, targetDir, signal: undefined,
                onProgress: (progress, message) => {
                  const t = installTasks.get(taskId)
                  if (t) { t.progress = progress; t.message = message }
                },
              })
              installTasks.set(taskId, { status: 'done', progress: 1, message: '完成', result, error: null })
            } catch (e) {
              installTasks.set(taskId, { status: 'error', progress: 0, message: e instanceof Error ? e.message : String(e), result: null, error: e instanceof Error ? e.message : String(e) })
            }
          })()
          return json({ taskId, status: 'running' })
        } catch (e) { return fail(e) }
      },
    },
    {
      name: 'env-status',
      description: 'Poll an install task: /env-status <taskId>.',
      handler(inv) {
        const taskId = inv.rawInput.trim().split(/\s+/)[0]
        const t = taskId && installTasks.get(taskId)
        if (!t) return fail(new Error('unknown task: ' + taskId))
        return json(t)
      },
    },
    {
      name: 'env-switch',
      description: 'Switch environment variables: /env-switch <tool> <installDir>.',
      async handler(inv) {
        try {
          const parts = inv.rawInput.trim().split(/\s+/).filter(Boolean)
          const tool = parts[0]
          const installDir = parts.slice(1).join(' ')
          if (!tool || !installDir) return fail(new Error('usage: /env-switch <tool> <installDir>'))
          return json(await switchTool(ctx, tool, installDir, { signal: inv.signal }))
        } catch (e) { return fail(e) }
      },
    },
    {
      name: 'env-recommend',
      description: 'Show recommended stable versions.',
      handler() { return json(recommendVersions()) },
    },
    {
      name: 'env-maven',
      description: 'Configure Maven settings.xml: /env-maven [aliyun|tencent|huawei|none].',
      handler(inv) {
        try {
          const mirror = inv.rawInput.trim().split(/\s+/)[0] || 'aliyun'
          return json(configureMaven({ mirror, overwrite: true }))
        } catch (e) { return fail(e) }
      },
    },
  ]

  for (const def of commands) {
    ctx.effect(() => ctx.commands.register(def))
  }
}
