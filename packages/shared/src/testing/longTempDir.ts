// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as HostProcess from "../HostProcess.ts";

// Windows 8.3 paths and macOS /var aliases must agree with realpath-based filesystem results.
const platform = HostProcess.Platform.defaultValue();
if (platform === "win32" || platform === "darwin") {
  try {
    const longForm = NodeFS.realpathSync.native(NodeOS.tmpdir());
    if (platform === "darwin") process.env.TMPDIR = longForm;
    else {
      process.env.TEMP = longForm;
      process.env.TMP = longForm;
    }
  } catch {}
}
