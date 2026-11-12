import {
  OrchestratorMcpThreadImportInput,
  OrchestratorMcpThreadImportResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const MoveWorkspace = Schema.Struct({
  version: Schema.Literal(1),
  identity: Schema.String,
  source: OrchestratorMcpThreadImportInput.fields.source,
  root: Schema.String,
  branch: Schema.String,
  tip: Schema.String,
  snapshot: Schema.String,
  incomingRef: Schema.String,
  gitDir: Schema.String,
  device: Schema.String,
  inode: Schema.String,
  adminDevice: Schema.String,
  adminInode: Schema.String,
  // Preserve shared creation provenance bytes; different metadata keeps the checkout.
  provenance: Schema.NullOr(Schema.String),
});
export const MoveReceipt = Schema.Struct({
  identity: Schema.String,
  result: OrchestratorMcpThreadImportResult,
});
