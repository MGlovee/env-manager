# Runtime version manager

A Host plugin that manages the local JDK, Node.js, Maven, and Python toolchains. It runs on the host machine, so it can read the whole filesystem, the user/system environment variables, and download releases.

## Web UI

The plugin also adds a small panel below the message composer (⚙ 运行环境版本管理器). It can scan the machine, list downloadable versions, install + switch a version, and write the Maven mirror config with one click. The panel drives the Host through the following slash commands, which you can also type directly:

- `/env-scan` — scan installed runtimes and environment variables.
- `/env-versions <jdk|node|maven|python> [limit] [filter]` — list downloadable versions.
- `/env-install <tool> <version> [--switch]` — download and install.
- `/env-switch <tool> <installDir>` — point HOME variables and PATH at a directory.
- `/env-recommend` — recommended stable versions.
- `/env-maven [aliyun|tencent|huawei|none]` — write Maven settings.xml.

## Tools

- `env_scan` — scan where each runtime is installed, its version, and the environment variables that point at it.
- `env_versions` — list versions available to download for the current platform (Windows / macOS / Linux), from official sources.
- `env_install` — download a version and unpack it into a directory (default `~/.envman/<tool>/<version>`), then optionally switch to it.
- `env_switch` — point `JAVA_HOME` / `M2_HOME` / `NODE_HOME` / `PYTHON_HOME` and `PATH` at an installed directory.
- `env_recommend` — recommended stable versions per runtime with a short rationale.
- `maven_config` — generate or update `~/.m2/settings.xml` with an Alibaba Cloud (or Tencent / Huawei) mirror and a local repository path in one step.

## Notes

- On Windows, `env_switch` writes the user-scoped environment variables (default) and updates `PATH` through the registry as an expandable string, so long paths are not truncated.
- On macOS / Linux, `env_switch` updates the shell profile (`~/.zshrc` or `~/.bash_profile`) so changes apply to new terminals.
- Python on Windows is installed from the official installer with a silent, per-user, per-directory install. On macOS the installer package is downloaded for manual install.
- Existing files are never overwritten silently: `maven_config` backs up an existing `settings.xml`, and `env_install` refuses to overwrite an existing directory unless forced.
