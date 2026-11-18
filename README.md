# env-manager · DeepSeek Harness 运行环境版本管理器

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件，用于管理本机的 **JDK / Node.js / Maven / Python** 版本：扫描已安装的运行时、从官方源下载任意版本、一键切换环境变量，以及快速配置 Maven 镜像。

插件同时提供了 **Web UI 面板**、**Agent 工具** 和 **斜杠命令** 三种使用方式，覆盖「点按钮」和「对话指令」两种场景。

> 灵感参考了 DevMate 与 ENVM 这类版本管理工具。

---

## 功能特性

- 🔍 **扫描本机环境**：找出 JDK / Node.js / Maven / Python 装在哪个目录、版本号、当前在 PATH 上生效的是哪个，以及 `JAVA_HOME` / `M2_HOME` / `NODE_HOME` / `PYTHON_HOME` / `PATH` 等环境变量。
- 📦 **列出可下载版本**：从官方源获取版本列表，自动识别 **Windows / macOS / Linux** 与 CPU 架构。
- ⬇️ **下载 + 安装**：下载到指定目录（默认 `~/.envman/<tool>/<version>`），自动解压/静默安装，带**真实下载进度条**。
- 🔀 **一键切换环境变量**：把某个已安装目录写入 `JAVA_HOME` / `M2_HOME` / `NODE_HOME` / `PYTHON_HOME` 并更新 `PATH`（Windows 走注册表 REG_EXPAND_SZ，不截断长路径；macOS/Linux 写 shell profile）。
- ⭐ **推荐版本**：给出每个运行时推荐的稳定版本及理由。
- ☁️ **Maven 一键配置**：生成/更新 `~/.m2/settings.xml`，一键切换阿里云 / 腾讯云 / 华为云镜像 + 本地仓库路径。

---

## 版本来源（均为官方源）

| 运行时 | 来源 |
|---|---|
| JDK | [Adoptium (Temurin) API](https://api.adoptium.net) |
| Node.js | [nodejs.org](https://nodejs.org/dist/) |
| Maven | [apache.org](https://dlcdn.apache.org/maven/) |
| Python | [python.org](https://www.python.org/api/v2/) |

---

## 安装

### 方式一：DSH 界面安装（推荐）

1. 克隆本仓库：
   ```bash
   git clone <repo-url>
   ```
2. 打开 DeepSeek Harness Web GUI → **插件（Plugins）** → **添加插件** → 选择克隆出来的 `env-manager/` 目录。

### 方式二：Agent 工具安装

在 DSH 会话中让 Agent 执行：

```
用 plugin_manager 安装本地插件目录 <env-manager 的绝对路径>
```

> 安装后插件在 Profile 内持久生效，重启不丢失。

---

## 使用

### 1. Web UI 面板

安装后，输入框下方会出现 **「⚙ 运行环境版本管理器」** 面板（点击展开/收起）：

- **扫描本机**：列出每个运行时已安装的目录、版本、当前生效版本，以及每个目录旁的「设为默认」按钮。
- **推荐版本**：显示推荐配置。
- **版本列表**：选一个运行时即可列出可下载版本，点击填入。
- **安装**：选择运行时 + 版本，可选**安装目录**（「选择…」调起系统目录选择器）和「配置到环境变量」，点击安装，显示**实时下载进度条**。
- **Maven 镜像**：选镜像后「一键配置」。

### 2. Agent 工具（对话中直接使用）

| 工具 | 说明 |
|---|---|
| `env_scan` | 扫描本机运行时与环境变量 |
| `env_versions` | 列出某运行时可下载的版本 |
| `env_install` | 下载并安装某版本（可指定目录、是否切换） |
| `env_switch` | 把某已安装目录配置到环境变量 |
| `env_recommend` | 返回推荐版本配置 |
| `maven_config` | 生成/更新 Maven settings.xml |

### 3. 斜杠命令

| 命令 | 说明 |
|---|---|
| `/env-scan` | 扫描已安装运行时与环境变量 |
| `/env-versions <jdk\|node\|maven\|python> [limit] [filter]` | 列出可下载版本 |
| `/env-install <tool> <version> [--switch] [--dir <path>]` | 下载安装（返回 taskId） |
| `/env-status <taskId>` | 查询安装进度 |
| `/env-switch <tool> <installDir>` | 切换环境变量 |
| `/env-recommend` | 推荐版本 |
| `/env-maven [aliyun\|tencent\|huawei\|none]` | 配置 Maven 镜像 |

---

## 目录结构

```
env-manager/
├── index.js              # Host 插件：注册 Agent 工具 + 斜杠命令
├── client.js             # Web UI：输入框下方面板
├── cordis.patch.yml      # 插件装载声明
├── package.json
├── icon.svg
├── locale/               # 中英文插件标题/描述
│   ├── en.json
│   └── zh.json
├── docs/
│   └── DETAIL.md         # 插件详情页
└── lib/
    ├── core.js           # 平台检测 / 子进程执行 / HTTP 请求
    ├── scan.js           # 扫描（目录 + PATH 反查 + 环境变量）
    ├── catalog.js        # 官方源版本列表 + 下载地址解析
    ├── install.js        # 下载 + 解压 + 进度
    ├── env.js            # 切换环境变量
    ├── maven.js          # settings.xml 生成
    └── recommend.js      # 推荐版本
```

---

## 技术说明

- **纯 Node.js 实现，零第三方运行时依赖**：Host 插件只用 Node 内置模块与 DSH 提供的 `ctx`（工具注册、子进程、命令），因此可被本地目录直接链接安装。
- **UI 与 Host 通过斜杠命令桥接**：面板用 DSH 核心的 `ctx.remote.commands` 调用 Host 注册的 `/env-*` 命令，返回 JSON 结果；安装为后台任务 + `/env-status` 轮询实现进度条。
- **下载进度**：通过 `node:stream` 的 `Transform` 在管道中计量字节；无 `Content-Length` 的源会回退为「已下载 X MB」提示。
- **环境变量切换**：Windows 用 `[Microsoft.Win32.Registry]` 以 `REG_EXPAND_SZ` 写 `PATH`（避免 1024 字符截断）；macOS/Linux 更新 shell profile。

---

## License

[MIT](./LICENSE) © hujunjie
