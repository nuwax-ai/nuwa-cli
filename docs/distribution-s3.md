# Distribution via Nuwax S3 (MinIO)

把 `nuwa-cli` 的 npm tarball 和安装器发布到 Nuwax 自有的 S3 兼容存储(MinIO,`s3.nuwax.com:9443`),让国内用户一行命令安装,不依赖 npm registry 登录、不踩 GitHub raw 的墙。

产品分流（新装 vs 升级）见 [`install-upgrade-split.md`](install-upgrade-split.md)。

## 为什么用 S3

- **国内可达**:`s3.nuwax.com:9443` 是自有 MinIO,无 GitHub raw / npm registry 的网络问题。
- **不依赖 npm 登录**:tarball 放公开桶,`npm install -g <tarball>` 直接装,bin/PATH/依赖仍由 npm 处理。
- **版本自控**:channel 指针(`beta.json`/`stable.json`)随时切流、回滚,不必等 npm 缓存。

## 桶布局

默认桶 `nuwax-packages`(可经 `NUWAX_S3_BUCKET` 覆盖);前缀 `agent-engines/nuwa-cli`。

```text
s3://nuwax-packages/
└── agent-engines/
    └── nuwa-cli/                                    # 项目维度
        ├── latest.json                              # 稳定版指针(stable 发布才更新;beta 不动)
        ├── channels/
        │   ├── stable.json                          # → { version, gitSha, releasedAt, ... }
        │   └── beta.json
        ├── install-from-s3.sh                       # bootstrap(每次 release 覆盖,一键命令指向它)
        ├── install-from-s3.ps1
        └── versions/
            └── 0.1.0-beta.3/                        # 一次发布 = 一个版本目录
                ├── artifacts/
                │   └── nuwax-ai-nuwa-cli-0.1.0-beta.3.tgz
                └── scripts/
                    ├── install-from-s3.sh
                    └── install-from-s3.ps1
```

- `artifacts/` 与 `scripts/` 带 `Cache-Control: immutable`(版本目录内容永不变)。
- `channels/*.json`、`latest.json`、根 bootstrap 带 `max-age=60, must-revalidate`(切流后 1 分钟内全球生效)。

## 发布

发布器:`scripts/publish-s3.sh`(需要 `aws` cli + `node`)。流程:build → `npm pack` → 上传 tarball + 安装器 → 重写 channel 指针 → 覆盖根 bootstrap。

完整 beta 发布统一使用：

```bash
npm run release:beta
```

固定顺序为：完整测试/构建 → npm beta 发布（同版本可重入）→
`cnpm sync @nuwax-ai/nuwa-cli` → npmmirror 版本与 beta tag 核验 →
S3 tarball/channel/bootstrap 发布。预演但不写外部服务可运行
`npm run release:beta:dry-run`。`lanproxy` 不在日常 CLI 发布流程内，仅在二进制变更时
单独运行 `npm run release:lanproxy`。

```bash
# 1) 配置(本机 ~/.aws [default] profile 已是 nuwax MinIO 凭证时,直接 source .env 拿 endpoint/bucket)
set -a; source .env; set +a

# 2) 发布(版本取自 package.json,channel 按 -beta 自动判定)
bash scripts/publish-s3.sh

# 或细粒度控制
bash scripts/publish-s3.sh --version 0.1.0-beta.3 --channel beta
bash scripts/publish-s3.sh --dry-run        # 只打印计划,不真传
```

### 凭证安全(重要)

- **凭证只从环境或 `~/.aws` profile 读,绝不入库**:`.env` 已在 `.gitignore`;`publish-s3.sh` 把 `NUWAX_S3_ACCESS_KEY_ID`/`NUWAX_S3_SECRET_ACCESS_KEY` 映射到 `AWS_*`(若 `AWS_*` 未设),否则交给 aws-cli 用 profile。脚本不打印凭证值。
- **安装侧零凭证**:tarball / 脚本 / channel 指针都是公开读,安装器用 `curl`/`Invoke-WebRequest` 或 `aws s3 cp --no-sign-request`,不需要、也不读取任何凭证。

### 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NUWAX_S3_ENDPOINT` | `https://s3.nuwax.com:9443` | MinIO/S3 endpoint |
| `NUWAX_S3_REGION` | `us-east-1` | region |
| `NUWAX_S3_BUCKET` | `nuwax-packages` | 桶名 |
| `NUWAX_S3_PREFIX` | `agent-engines/nuwa-cli` | 项目前缀 |
| `NUWAX_S3_NO_VERIFY_SSL` | `0` | 设 `1` 用于自签 MinIO |
| `NUWAX_S3_ACCESS_KEY_ID` / `NUWAX_S3_SECRET_ACCESS_KEY` | — | 凭证;未设则用 `~/.aws` profile |

`.env` 模板(本机用,gitignore):

```ini
NUWAX_S3_ENDPOINT=https://s3.nuwax.com:9443
NUWAX_S3_REGION=us-east-1
NUWAX_S3_BUCKET=nuwax-packages
NUWAX_S3_PREFIX=agent-engines/nuwa-cli
NUWAX_S3_NO_VERIFY_SSL=1
# NUWAX_S3_ACCESS_KEY_ID=     # 通常留空,用 ~/.aws profile
# NUWAX_S3_SECRET_ACCESS_KEY=
```

## 安装(用户侧)

**日常推荐入口 · 新装**（交互向导，选语言 / 停服务 / 装包 / 登录 / start；文档默认不带 `-y`）：

```bash
npx @nuwax-ai/nuwa-cli@latest install
```

自动化：`npx -y @nuwax-ai/nuwa-cli@latest install --yes`。已安装后升级请用 `nuwa-cli update`（增量路径 + 停服务确认 + 已登录 restart）。

**S3 一键**适合国内网络 / 无 npm 登录场景（公开读,无需凭证、无需 aws-cli）。按是否已安装分流：

| 本机状态 | S3 脚本行为 |
|----------|-------------|
| 未安装 | 下 tarball → `npm i -g` → 配 PATH → `nuwa-cli install --yes --bootstrap` |
| 已装、版本不同 | `nuwa-cli update <VERSION> --yes`（update 内核；已登录 restart） |
| 同版本 | 跳过（不 restart、不 bootstrap） |

```bash
# Windows (PowerShell)
irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex

# macOS / Linux
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
```

可选环境变量:

| 变量 | 默认 | 说明 |
|---|---|---|
| `NUWACLI_CHANNEL` | `stable` | 安装的 channel |
| `NUWACLI_VERSION` | — | 直接指定版本,跳过 channel 解析 |
| `NUWACLI_REGISTRY` | npmmirror（S3 脚本） | 透传给 `npm install --registry` |
| `NUWAX_S3_INSECURE` | `0` | 设 `1` 跳过证书校验(自签 MinIO);不设时也会在证书失败后自动降级 `-k` 重试 |
| `NUWACLI_NO_START` | `0` | 设 `1` 时新装跳过 `install --yes --bootstrap` |

### 升级场景的 serve 处理

升级走 **`nuwa-cli update`**（S3 已装分支亦调用它）：先停服并释放 Windows vendor `.exe` 锁，再增量或全量安装；成功后若已登录（`~/.nuwa-cli/credentials.json` 的 `configKey`）则 **`restartServeIfLoggedIn`**。未登录则跳过 restart。新装路径用 `start` / bootstrap，不与 upgrade restart 叠用。

**Windows 注意：** 服务运行中请勿裸跑 `npm i -g @nuwax-ai/nuwa-cli@…`；请用 `nuwa-cli update` 或本安装脚本的升级分支。二次调用请用本会话 PATH 或 `nuwa-cli.cmd` 绝对路径。

## channel / latest 指针

- 每次 `--channel beta` 发布覆盖 `channels/beta.json`;`--channel stable` 同时覆盖 `channels/stable.json` 与 `latest.json`。
- beta **不**更新 `latest.json`(避免 beta 成为"最新稳定版")。
- 指针体:`{ schema, channel, version, gitSha, releasedAt, artifactBase }`。

## 切流 / 回滚

- **切 beta**:发一版 `--channel beta`,`channels/beta.json` 指向新版本,bootstrap 立即跟随。
- **回滚**:重新发布旧版本号(`--version <旧版本> --channel <channel>`),指针指回旧版;版本目录是不可变缓存,旧 tarball 仍在。
- **固定版本安装**:`NUWACLI_VERSION=0.1.0-beta.2 curl ... | bash`,绕过 channel。

## 与 npm registry 的关系

- **产品新装入口**:`npx … install`（registry）。
- **产品卸载入口**:`npx … uninstall`（默认保留 `~/.nuwa-cli`；`--purge` 才清数据）。S3 `uninstall-from-s3.*` 仅作兼容。
- **国内镜像新装 / 升级进线**:S3 一键脚本（按是否已装分流到 tarball 或 `update`）。
- **日常升级**:`nuwa-cli update`（registry；与 S3 升级共用内核）。
- **legacy**:`scripts/install.sh` / `install.ps1`（直连 registry + PATH）不作为产品入口宣传。

装出的全局包一致；差别只在进线与是否走交互向导。
