# 新装 / 升级分流与 S3↔install 收口

产品口径：`install` 负责新装（到可运行）；`update` 负责升级（停服 / 释锁 / 增量 + 已登录 restart）；`uninstall` 负责卸全局包（默认保留 `~/.nuwa-cli`）。npx 与 S3 只是进线方式，按是否已安装分流，装包与重启不平行实现两套逻辑。

## 分流表

| 场景 | 入口 | 装包 | 拉起 |
|------|------|------|------|
| **新装**（全局无 `nuwa-cli`） | `npx … install`（推荐）或 S3 一键 | 新包装上 | 向导收尾 → 登录 / `start`；S3 用 `--yes` 静默 |
| **升级**（全局已装） | **`nuwa-cli update`** | update 内核 | **已登录 → `restartServeIfLoggedIn`** |
| S3 且已装、版本不同 | 脚本调 `update <VERSION> --yes` | 不再 tarball overlay | update 内 restart |
| S3 同版本 | 整段 skip | 无 | 无 restart / 无 bootstrap |
| `npx install` 且已装 | 提示改用 `update` | 仅 `--force` 经 update 内核覆盖 | 再 bootstrap |
| **卸载** | `npx … uninstall` | `npm uninstall -g`（先停服 / 卸自启） | 默认保留 `~/.nuwa-cli`；`--purge` 才删 |

`scripts/install.sh` / `install.ps1`：legacy registry 脚本，不作为产品入口宣传。  
`scripts/uninstall-from-s3.*`：兼容脚本，产品主推 npx `uninstall`。

## 流程

```text
npx … install
  ├─ 未安装 → npm i -g → bootstrap（交互：已登录可跳过登录 → start）
  ├─ 已安装、无 --force → 提示 nuwa-cli update
  └─ --force → updateCommand(tag, { force, yes }) → bootstrap

npx … uninstall
  ├─ 停服 + service uninstall + npm uninstall -g
  ├─ 默认保留 ~/.nuwa-cli
  └─ --purge → 删除用户数据

curl …/install-from-s3.sh | bash   (或 Windows irm|iex)
  ├─ 未安装 → S3 tarball → npm i -g → PATH → install --yes --bootstrap
  ├─ 已安装、版本不同 → update VERSION --yes（已登录则 restart；未登录可选静默 hint）
  └─ 同版本 → skip

日常升级 → nuwa-cli update
```

## 关键实现

| 模块 | 要点 |
|------|------|
| [`src/commands/install.ts`](../src/commands/install.ts) | `bootstrapAfterInstall`；`--bootstrap` / `--no-start`；`--force` → `updateCommand` |
| [`src/commands/update.ts`](../src/commands/update.ts) | 导出 `restartServeIfLoggedIn`；停服 / 增量 / 全量 |
| [`src/commands/uninstall.ts`](../src/commands/uninstall.ts) | 停服 / 卸自启 / `npm uninstall -g`；默认保留数据；`--purge` |
| [`scripts/install-from-s3.sh`](../scripts/install-from-s3.sh) / [`.ps1`](../scripts/install-from-s3.ps1) | 新装 vs 升级分流；Windows 用绝对路径二次调用 |
| Flags | `--yes` 静默；`NUWACLI_NO_START=1` 跳过 bootstrap |

## 避免的逻辑坑

1. **Restart 与 start 双拉**：升级只走 `restartServeIfLoggedIn`；新装 / `--bootstrap` 走 `startCommand`（复用已就绪栈，不 `--force`）。S3 升级成功且已登录后**不再** `install --bootstrap`。
2. **S3 升级版本钉死**：`update <S3 VERSION> --yes`，不用平行 tarball overlay。
3. **Windows PATH**：二次调用用本会话已刷新 PATH 或 `nuwa-cli.cmd` 绝对路径；`irm|iex` 默认 `--yes`。
4. **同版本 skip**：不重装、不 restart、不 bootstrap。
5. **卸载入口优先 npx**：避免全局进程自我 `npm uninstall`（Windows 上更稳）；与 `service uninstall` 区分。

## 逃生口

- `nuwa-cli install --no-start`：只装包
- `NUWACLI_NO_START=1`：S3 新装跳过 bootstrap
- `nuwa-cli install --force`：覆盖重装（内部 update --force）
- `nuwa-cli uninstall --purge`：卸包并删除 `~/.nuwa-cli`

## 相关文档

- [`distribution-s3.md`](distribution-s3.md) — S3 桶布局与发布
- [`local-debugging.md`](local-debugging.md) — 本地调试 install / update
