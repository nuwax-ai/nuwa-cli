import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readScript(name: string): string {
  return fs.readFileSync(path.join(root, "scripts", name), "utf8");
}

describe("install script progress", () => {
  it.each(["install.sh", "install-from-s3.sh"])(
    "%s enables npm progress and displays staged installation feedback",
    (name) => {
      const script = readScript(name);

      expect(script).toContain("--progress=true");
      expect(script).toContain("INSTALL_STARTED=$SECONDS");
      expect(script).toContain("依赖安装完成，耗时");
      expect(script).toContain("progress_bar");
      expect(script).toContain("正在下载并安装依赖（估算）");
      expect(script).toMatch(/step 1 [34]/);
      expect(script).toMatch(/step [34] [34] "配置 PATH 并验证 nuwa-cli/);
    },
  );

  it.each(["install.ps1", "install-from-s3.ps1"])(
    "%s enables npm progress and displays staged installation feedback",
    (name) => {
      const script = readScript(name);

      expect(script).toContain('"--progress=true"');
      expect(script).toContain("[Diagnostics.Stopwatch]::StartNew()");
      expect(script).toContain("Dependencies installed in");
      expect(script).toContain("Write-Progress");
      expect(script).toContain("PercentComplete $percent");
      expect(script).toContain("Start-Process");
      expect(script).toContain("-EncodedCommand");
      expect(script).toContain("$child.ExitCode");
      expect(script).toContain("Get-Content $stderrLog -Raw");
      expect(script).not.toContain("Start-Job -ScriptBlock");
      expect(script).not.toContain("$output = Receive-Job");
      expect(script).toMatch(/Step 1 [34] "/);
      expect(script).toMatch(
        /Step [34] [34] "Configuring PATH and verifying nuwa-cli/,
      );
    },
  );

  it("uses npmmirror by default for the domestic S3 installers", () => {
    expect(readScript("install-from-s3.sh")).toContain(
      "NUWACLI_REGISTRY:-https://registry.npmmirror.com",
    );
    expect(readScript("install-from-s3.ps1")).toContain(
      '"https://registry.npmmirror.com"',
    );
  });

  it("skips npm install when CLI is already at the resolved target version", () => {
    const sh = readScript("install.sh");
    expect(sh).toContain("SKIP_INSTALL=0");
    expect(sh).toContain('view "${PACKAGE}@${TAG}" version');
    expect(sh).toContain("已安装，跳过 npm install");
    expect(sh).toContain('if [ "$SKIP_INSTALL" = "0" ]; then');

    const ps1 = readScript("install.ps1");
    expect(ps1).toContain("$SkipInstall = $false");
    expect(ps1).toContain('"view", "$Package@$Tag", "version"');
    expect(ps1).toContain("already installed; skipping npm install");
    expect(ps1).toContain("if (-not $SkipInstall)");
  });

  it("stops running services before overlay install on Unix install.sh", () => {
    const sh = readScript("install.sh");
    expect(sh).toContain("nuwa-cli stop --all");
    expect(sh).toContain("command -v nuwa-cli");
  });

  it("releases Windows vendor exe locks before npm install and null-safes log Trim", () => {
    const ps1 = readScript("install.ps1");
    expect(ps1).toContain("nuwax-codex.exe");
    expect(ps1).toContain("nuwax-lanproxy.exe");
    expect(ps1).toContain("nuwa-cli stop --all");
    expect(ps1).toContain("Get-Process -Name $procName");
    expect(ps1).toContain("Prefer: nuwa-cli update");
    expect(ps1).toContain('if ($null -eq $stdout) { $stdout = "" }');
    expect(ps1).toContain('if ($null -eq $stderr) { $stderr = "" }');

    const s3ps1 = readScript("install-from-s3.ps1");
    expect(s3ps1).toContain("nuwax-codex.exe");
    expect(s3ps1).toContain("nuwax-lanproxy.exe");
    expect(s3ps1).toContain("Get-Process -Name $procName");
    expect(s3ps1).toContain('if ($null -eq $stdout) { $stdout = "" }');
    expect(s3ps1).toContain('if ($null -eq $stderr) { $stderr = "" }');

    const s3sh = readScript("install-from-s3.sh");
    expect(s3sh).toContain("taskkill //F //IM nuwax-codex.exe");
    expect(s3sh).toContain('IMAGENAME eq ${image}');
  });

  it("S3 scripts split new-install vs upgrade: tarball+bootstrap vs update VERSION --yes", () => {
    const sh = readScript("install-from-s3.sh");
    expect(sh).toContain("install --yes --bootstrap");
    expect(sh).toContain('update "$VERSION" --yes');
    expect(sh).toContain("NUWACLI_NO_START");
    expect(sh).toContain('NUWA_BIN_PRE="$(resolve_nuwa_cli || true)"');
    expect(sh).toContain('INSTALLED_VERSION="$("$NUWA_BIN_PRE" --version');
    expect(sh).not.toMatch(/nuwa-cli restart/);

    const ps1 = readScript("install-from-s3.ps1");
    expect(ps1).toContain("install --yes --bootstrap");
    expect(ps1).toContain("update $version --yes");
    expect(ps1).toContain("NUWACLI_NO_START");
    expect(ps1).toContain("Resolve-NuwaCli");
    expect(ps1).toContain("$nuwaBinPre = Resolve-NuwaCli");
    expect(ps1).toContain("(& $nuwaBinPre --version 2>$null).Trim()");
    expect(ps1).toContain("$bootText = Format-CliCapture $bootOutput");
    expect(ps1).not.toMatch(/& nuwa-cli restart/);
    expect(ps1).not.toContain(
      'Invoke-NativeUtf8 { & $nuwaBin install --yes --bootstrap 2>&1 } | Out-Null',
    );
  });
});
