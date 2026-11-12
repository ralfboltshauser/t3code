import * as Effect from "effect/Effect";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../../processRunner.ts";

const inspectAttributes = `import os,stat,sys,ctypes
root=sys.argv[1]
expected=sys.argv[2]
mac=sys.platform=='darwin'
if mac:
 libc=ctypes.CDLL(None,use_errno=True)
 libc.listxattr.restype=ctypes.c_ssize_t
 libc.getxattr.restype=ctypes.c_ssize_t
 def attributes(p):
  p=os.fsencode(p)
  n=libc.listxattr(p,None,0,1)
  if n<0 or n>65536:raise RuntimeError('attribute inspection failed')
  b=ctypes.create_string_buffer(n)
  if libc.listxattr(p,b,n,1)!=n:raise RuntimeError('attributes changed')
  names=b.raw.split(b'\\0')[:-1]
  if names!=[b'com.apple.provenance']:return 'clear' if not names and not expected else 'metadata'
  n=libc.getxattr(p,b'com.apple.provenance',None,0,0,1)
  if n<0 or n>128:return 'metadata'
  b=ctypes.create_string_buffer(n)
  if libc.getxattr(p,b'com.apple.provenance',b,n,0,1)!=n:raise RuntimeError('attribute changed')
  return 'clear' if expected and b.raw.hex()==expected else 'metadata'
else:
 def attributes(p):return 'metadata' if os.listxattr(p,follow_symlinks=False) else 'clear'
pending=[root]
count=0
while pending:
 p=pending.pop()
 s=os.lstat(p)
 if attributes(p)!='clear' or getattr(s,'st_flags',0) or s.st_uid!=os.getuid() or s.st_gid!=os.getgid():
  print('metadata');sys.exit(0)
 if stat.S_ISDIR(s.st_mode):
  with os.scandir(p) as entries:
   for e in entries:
    if p==root and e.name=='.git':continue
    count+=1
    if count>10000:raise RuntimeError('inspection limit')
    pending.append(e.path)
print('clear')`;

export const moveWorkspaceProvenance = Effect.fn("MoveWorkspace.provenance")(function* (
  root: string,
) {
  if ((yield* HostProcess.Platform) !== "darwin") return null;
  const runner = yield* ProcessRunner.make();
  const result = yield* runner.run({
    command: "/usr/bin/xattr",
    args: ["-s", "-px", "com.apple.provenance", root],
    cwd: root,
    maxOutputBytes: 1024,
  });
  const value = result.stdout.replace(/\s/g, "").toLowerCase();
  return result.code === 0 && /^[a-f0-9]{2,256}$/.test(value) ? value : null;
});

export const moveWorkspaceMetadataReason = Effect.fn("MoveWorkspace.metadataReason")(function* (
  root: string,
  paths: ReadonlyArray<string>,
  provenance: string | null,
) {
  const runner = yield* ProcessRunner.make();
  const attributes = yield* runner.run({
    command: "python3",
    args: ["-c", inspectAttributes, root, provenance ?? ""],
    cwd: root,
    maxOutputBytes: 1024,
  });
  if (attributes.code !== 0 || attributes.stdout.trim() !== "clear")
    return "Extended attributes, ownership or filesystem flags require preserving this source.";
  if ((yield* HostProcess.Platform) === "darwin")
    for (let start = 0; start < paths.length; start += 16) {
      const acl = yield* runner.run({
        command: "/bin/ls",
        args: ["-lde", ...paths.slice(start, start + 16)],
        cwd: root,
      });
      if (
        acl.code !== 0 ||
        acl.stdoutTruncated ||
        /^\s+\d+:\s/m.test(acl.stdout) ||
        /^[bcdlps-][rwxstST-]{9}\+/m.test(acl.stdout)
      )
        return "Filesystem access control lists require preserving this source.";
    }
  return null;
});
