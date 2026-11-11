import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_orchestration_v2_thread_move_fences
    ON orchestration_v2_projection_threads(thread_id)
    WHERE json_extract(payload_json, '$.handoff.state') = 'departing'
      OR (json_extract(payload_json, '$.handoff.state') = 'departed'
        AND json_extract(payload_json, '$.handoff.retirement.root') IS NOT NULL)`;
});
