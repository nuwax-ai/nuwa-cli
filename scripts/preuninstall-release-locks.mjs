/**
 * preuninstall 尽力释放 Windows 上可能锁住 vendor .exe 的进程。
 *
 * 不能替代「install 前先 stop」：npm 若在拷贝旧树到 staging 时就 EBUSY，
 * 本脚本根本跑不到。装上带此钩子的版本后，后续卸载/部分升级路径多一层保险。
 *
 * 不依赖已构建的 dist/cli.js（卸载中途可能不可用），只做 taskkill（多轮）。
 */

import { spawnSync } from "node:child_process";

const IMAGES = ["nuwax-codex.exe", "nuwax-lanproxy.exe"];

if (process.platform === "win32" && !process.env.VITEST) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const image of IMAGES) {
      spawnSync("taskkill", ["/F", "/IM", image], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
        stdio: "ignore",
      });
    }
    // 短等，给 OS 放下文件锁；最后一轮不再等。
    if (attempt < 2) {
      spawnSync("cmd", ["/c", "ping", "127.0.0.1", "-n", "2"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
    }
  }
}
