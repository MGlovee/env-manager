/* Browser half of env-manager: a composer-dock panel driving the Host via slash commands. */

window.__ModuleLoader__.load({
  id: '@local/env-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useCallback, useEffect } = React

    const TOOLS = [
      { id: 'jdk', label: 'JDK' },
      { id: 'node', label: 'Node.js' },
      { id: 'maven', label: 'Maven' },
      { id: 'python', label: 'Python' },
    ]

    const sx = {
      box: { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 },
      row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      card: { border: '1px solid var(--dsw-alias-border, rgba(128,128,128,.25))', borderRadius: 8, padding: 10 },
      head: { fontSize: 13, fontWeight: 600, margin: 0, cursor: 'pointer', userSelect: 'none' },
      muted: { color: 'var(--dsw-alias-muted, #888)', fontSize: 12, margin: 0 },
      code: { fontFamily: 'ui-monospace, monospace', fontSize: 12, wordBreak: 'break-all', margin: '2px 0' },
      btn: { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, rgba(128,128,128,.35))', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 12 },
      primary: { padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--dsw-alias-accent, #2f6fed)', color: '#fff', cursor: 'pointer', fontSize: 12 },
      input: { padding: '5px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, rgba(128,128,128,.35))', background: 'transparent', color: 'inherit', fontSize: 12 },
      select: { padding: '5px 8px', borderRadius: 6, border: '1px solid var(--dsw-alias-border, rgba(128,128,128,.35))', background: 'transparent', color: 'inherit', fontSize: 12 },
      err: { color: 'var(--dsw-alias-danger, #e5484d)', fontSize: 12, margin: 0 },
      progressWrap: { height: 6, borderRadius: 3, background: 'rgba(128,128,128,.2)', overflow: 'hidden', width: '100%' },
      progressBar: { height: '100%', background: 'var(--dsw-alias-accent, #2f6fed)', transition: 'width .3s', borderRadius: 3 },
    }

    function Panel(props) {
      const { sessionId, commands, pickDirectory } = props
      const [open, setOpen] = useState(false)
      const [scan, setScan] = useState(null)
      const [versions, setVersions] = useState({})
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [tool, setTool] = useState('jdk')
      const [version, setVersion] = useState('')
      const [switchOn, setSwitchOn] = useState(true)
      const [targetDir, setTargetDir] = useState('')
      const [mirror, setMirror] = useState('aliyun')
      const [progress, setProgress] = useState(null)
      const [progressMsg, setProgressMsg] = useState('')

      const runCommand = useCallback(async (line) => {
        try {
          const res = await commands.execute(sessionId, line, [])
          if (!res.ok) throw new Error(res.error.message)
          if (!res.value) throw new Error('unknown command: ' + line)
          const cmd = res.value.result
          if (cmd.kind === 'error') throw new Error(cmd.text)
          return cmd.text
        } catch (e) {
          return null
        }
      }, [sessionId, commands])

      const exec = useCallback(async (line, label) => {
        setBusy(label)
        setError('')
        setNotice('')
        try {
          const text = await runCommand(line)
          if (text == null) { setError('命令执行失败'); return null }
          return text
        } catch (e) {
          setError(e && e.message ? e.message : String(e))
          return null
        } finally {
          setBusy('')
        }
      }, [runCommand])

      const doScan = async () => {
        const text = await exec('/env-scan', 'scan')
        if (text != null) { try { setScan(JSON.parse(text)) } catch { setError('无法解析扫描结果') } }
      }
      const doVersions = async (id) => {
        setTool(id)
        const text = await exec('/env-versions ' + id + ' 15', 'versions')
        if (text != null) { try { setVersions((prev) => ({ ...prev, [id]: JSON.parse(text) })) } catch { setError('无法解析版本列表') } }
      }
      const chooseDir = async () => {
        try {
          const dir = await pickDirectory()
          if (dir) setTargetDir(dir)
        } catch (e) {
          setError('打开目录选择器失败：' + (e && e.message ? e.message : String(e)))
        }
      }
      const doInstall = async () => {
        if (!version) return setError('请输入版本号')
        let line = '/env-install ' + tool + ' ' + version
        if (switchOn) line += ' --switch'
        if (targetDir) line += ' --dir ' + targetDir
        const text = await exec(line, 'install')
        if (text == null) return
        let taskId
        try { taskId = JSON.parse(text).taskId } catch { return setError('无法启动安装') }
        setProgress(0)
        setProgressMsg('准备中…')
        const timer = setInterval(async () => {
          const s = await runCommand('/env-status ' + taskId)
          if (s == null) return
          let st
          try { st = JSON.parse(s) } catch { return }
          setProgress(typeof st.progress === 'number' ? st.progress : 0)
          setProgressMsg(st.message || '')
          if (st.status === 'done') {
            clearInterval(timer)
            setProgress(null)
            setProgressMsg('')
            setNotice('安装完成：' + ((st.result && st.result.installedDir) || '已安装'))
            void doScan()
          } else if (st.status === 'error') {
            clearInterval(timer)
            setProgress(null)
            setProgressMsg('')
            setError(st.error || '安装失败')
          }
        }, 1200)
      }
      const doMaven = async () => {
        const text = await exec('/env-maven ' + mirror, 'maven')
        if (text != null) {
          try { setNotice('Maven 配置完成：' + (JSON.parse(text).settingsPath || '')) } catch { setNotice('Maven 配置完成') }
        }
      }
      const doSwitch = async (id, dir) => {
        const text = await exec('/env-switch ' + id + ' ' + dir, 'switch')
        if (text != null) {
          try {
            const r = JSON.parse(text)
            const changed = r && r.changed ? Object.keys(r.changed)[0] + '=' + r.changed[Object.keys(r.changed)[0]] : dir
            setNotice('已配置到环境变量：' + changed)
            void doScan()
          } catch { setNotice('已配置到环境变量：' + dir) }
        }
      }

      useEffect(() => { void doVersions('jdk') }, [])

      if (!open) {
        return h('div', { style: sx.box },
          h('p', { style: sx.head, onClick: () => setOpen(true) }, '⚙ 运行环境版本管理器'),
        )
      }

      return h('div', { style: sx.box },
        h('p', { style: sx.head, onClick: () => setOpen(false) }, '⚙ 运行环境版本管理器（收起）'),
        h('div', { style: sx.row },
          h('button', { style: sx.primary, onClick: doScan, disabled: !!busy }, busy === 'scan' ? '扫描中…' : '扫描本机'),
          h('button', { style: sx.btn, onClick: () => exec('/env-recommend', 'recommend').then((t) => { if (t) { try { setScan(JSON.parse(t)) } catch {} } }) }, busy === 'recommend' ? '…' : '推荐版本'),
        ),
        error && h('p', { style: sx.err }, error),
        notice && h('p', { style: sx.muted }, notice),

        scan && scan.tools && h('div', { style: sx.card },
          TOOLS.map((t) => {
            const info = scan.tools[t.id]
            if (!info) return null
            return h('div', { key: t.id, style: { marginBottom: 8 } },
              h('div', { style: sx.row },
                h('strong', null, t.label),
                info.active && info.active.version && h('span', { style: sx.muted }, '当前 ' + info.active.version),
                h('button', { style: sx.btn, onClick: () => doVersions(t.id) }, busy === 'versions' ? '…' : '版本'),
              ),
              (info.installs && info.installs.length > 0)
                ? info.installs.slice(0, 6).map((i, idx) => h('div', { key: idx, style: sx.row },
                    h('span', { style: sx.code }, (i.version || '?') + '  ' + i.dir),
                    h('button', { style: sx.btn, onClick: () => doSwitch(t.id, i.dir), disabled: !!busy }, busy === 'switch' ? '…' : '设为默认'),
                  ))
                : h('p', { style: sx.muted }, '未发现安装目录'),
            )
          }),
        ),

        versions[tool] && versions[tool].versions && h('div', { style: sx.card },
          h('p', { style: sx.muted }, (TOOLS.find((t) => t.id === tool)?.label || tool) + ' 可下载版本（点击选择）'),
          h('div', { style: sx.row },
            (versions[tool].versions || []).slice(0, 15).map((v) => h('button', { key: v.version, style: sx.btn, onClick: () => setVersion(v.version) }, v.version + (v.lts ? ' LTS' : ''))),
          ),
        ),

        h('div', { style: sx.card },
          h('p', { style: sx.muted }, '安装新版本'),
          h('div', { style: sx.row },
            h('select', { style: sx.select, value: tool, onChange: (e) => { setTool(e.target.value); void doVersions(e.target.value) } },
              TOOLS.map((t) => h('option', { key: t.id, value: t.id }, t.label))),
            h('input', { style: sx.input, placeholder: '版本，如 21 / lts / 3.12.2', value: version, onChange: (e) => setVersion(e.target.value) }),
          ),
          h('div', { style: sx.row },
            h('input', { style: { ...sx.input, flex: 1, minWidth: 240 }, placeholder: '安装目录（留空默认 ~/.envman/<tool>/<version>）', value: targetDir, onChange: (e) => setTargetDir(e.target.value) }),
            h('button', { style: sx.btn, onClick: chooseDir }, '选择…'),
          ),
          h('div', { style: sx.row },
            h('label', { style: sx.row },
              h('input', { type: 'checkbox', checked: switchOn, onChange: (e) => setSwitchOn(e.target.checked) }),
              h('span', { style: sx.muted }, '配置到环境变量'),
            ),
            h('button', { style: sx.primary, onClick: doInstall, disabled: !!busy || progress != null }, busy === 'install' ? '启动中…' : '安装'),
          ),
          progress != null && h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 } },
            h('p', { style: sx.muted }, progressMsg || '安装中…'),
            h('div', { style: sx.progressWrap },
              h('div', { style: { ...sx.progressBar, width: Math.round(Math.min(Math.max(progress, 0), 1) * 100) + '%' } }),
            ),
          ),
        ),

        h('div', { style: sx.row },
          h('span', { style: sx.muted }, 'Maven 镜像'),
          h('select', { style: sx.select, value: mirror, onChange: (e) => setMirror(e.target.value) },
            h('option', { value: 'aliyun' }, '阿里云'),
            h('option', { value: 'tencent' }, '腾讯云'),
            h('option', { value: 'huawei' }, '华为云'),
            h('option', { value: 'none' }, '不使用镜像')),
          h('button', { style: sx.primary, onClick: doMaven, disabled: !!busy }, busy === 'maven' ? '写入中…' : '一键配置'),
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.commands', 'uiWorkspace'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'env-manager',
          order: 10,
          label: () => 'Runtime versions',
          inject: (sessionId) => ({
            sessionId,
            commands: ctx.remote.commands,
            pickDirectory: () => ctx.uiWorkspace.pickDirectory(),
          }),
        }, Panel))
      },
    }
  },
})
