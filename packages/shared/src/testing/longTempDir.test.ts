// @effect-diagnostics nodeBuiltinImport:off - exercises process-start test setup against a real symlink.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";
import * as HostProcess from "../HostProcess.ts";

it("canonicalizes platform temp aliases while preserving the symlink itself", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "temp-alias-"));
  try {
    const directory = NodePath.join(root, "real");
    const alias = NodePath.join(root, "alias");
    NodeFS.mkdirSync(directory);
    NodeFS.symlinkSync(directory, alias, "junction");
    const setup = NodeURL.pathToFileURL(NodePath.join(import.meta.dirname, "longTempDir.ts")).href;
    const actual = NodeChildProcess.execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `await import(${JSON.stringify(setup)}); console.log((await import('node:os')).tmpdir())`,
      ],
      { env: { ...process.env, TMPDIR: alias, TEMP: alias, TMP: alias }, encoding: "utf8" },
    ).trim();
    const platform = HostProcess.Platform.defaultValue();
    expect(actual).toBe(
      platform === "darwin" || platform === "win32" ? NodeFS.realpathSync.native(directory) : alias,
    );
    expect(NodeFS.lstatSync(alias).isSymbolicLink()).toBe(true);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});
