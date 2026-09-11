import { historyHeadPayload } from "./thread-history-relations";
import { historyContentPayload } from "./thread-history-schema";

/** Active chain membership, ordered through the single turn-position owner.
 * CROSS JOIN keeps the range owner outermost so LIMIT can stop the index walk
 * before materializing or sorting the rest of a long conversation. */
export const historyMemberSource = `codewide_history_turns p
  CROSS JOIN codewide_history_members m ON m.connection_id=p.connection_id AND m.thread_id=p.thread_id
    AND m.history_epoch=p.history_epoch AND m.turn_id=p.turn_id
  CROSS JOIN codewide_history_content c ON c.content_id=m.content_id
  JOIN codewide_history_heads h ON h.connection_id=p.connection_id AND h.thread_id=p.thread_id AND h.active_epoch=p.history_epoch`;

/** All retained memberships for exact turn-id cache reuse. Range reads must
 * use historyMemberSource; this source is only for server-named identities. */
export const retainedHistoryMemberSource = `codewide_history_turns p
  CROSS JOIN codewide_history_members m ON m.connection_id=p.connection_id AND m.thread_id=p.thread_id
    AND m.history_epoch=p.history_epoch AND m.turn_id=p.turn_id
  CROSS JOIN codewide_history_content c ON c.content_id=m.content_id
  JOIN codewide_history_heads h ON h.connection_id=p.connection_id AND h.thread_id=p.thread_id`;

// Live overlays start at the small partial content index, not every sealed turn.
const liveSource = `codewide_history_content c CROSS JOIN codewide_history_members m ON m.content_id=c.content_id
  CROSS JOIN codewide_history_turns p ON p.connection_id=m.connection_id AND p.thread_id=m.thread_id
    AND p.history_epoch=m.history_epoch AND p.turn_id=m.turn_id
  JOIN codewide_history_heads h ON h.connection_id=p.connection_id AND h.thread_id=p.thread_id AND h.active_epoch=p.history_epoch`;
const liveScope = "c.connection_id=?1 AND c.thread_id=?2 AND c.sealed=0";

/** Materialization belongs after scope/range selection, never before a global UNION. */
export const historyMemberPayload = `json_set(${historyContentPayload()}, '$.historyEpoch', p.history_epoch, '$.ordinal', p.ordinal)`;

/** Scope occupies the first two positional parameters in all native history reads. */
export const historyScope = "p.connection_id=?1 AND p.thread_id=?2";

/** Direct metadata read, without evaluating unrelated history or pending branches. */
export const historyMetaSql = `SELECT ${historyHeadPayload()} AS __payload
  FROM codewide_history_heads h JOIN codewide_history_chains g
    ON g.connection_id=h.connection_id AND g.thread_id=h.thread_id AND g.history_epoch=h.active_epoch
  WHERE h.connection_id=?1 AND h.thread_id=?2`;

/** Mutable head, active items and independent delivery intents share a scoped result. */
export const historyLiveSql = `${historyMetaSql} AND h.active_epoch=?3
  UNION ALL SELECT ${historyMemberPayload} FROM ${liveSource}
    WHERE ${liveScope} AND p.history_epoch=?3
  UNION ALL SELECT payload FROM codewide_history_pending WHERE connection_id=?1 AND thread_id=?2`;

const sealedTurns = `FROM ${historyMemberSource}
  WHERE ${historyScope} AND p.history_epoch=(SELECT history_epoch FROM chain) AND c.kind='turn' AND c.sealed=1`;

/** One native call resolves bounds and reads only the requested turn families. */
export function resolvedHistoryWindowSql(): string {
  return `WITH
    chain AS MATERIALIZED (SELECT COALESCE((SELECT active_epoch FROM codewide_history_heads
      WHERE connection_id=?1 AND thread_id=?2),0) AS history_epoch),
    bounds AS MATERIALIZED (SELECT history_epoch,
      (SELECT p.ordinal ${sealedTurns} ORDER BY p.ordinal DESC,p.turn_id DESC LIMIT 1) AS latest_ordinal,
      (SELECT p.ordinal ${sealedTurns} ORDER BY p.ordinal ASC,p.turn_id ASC LIMIT 1) AS earliest_ordinal,
      (SELECT p.ordinal ${sealedTurns} AND p.turn_id=?3 LIMIT 1) AS anchor_ordinal FROM chain),
    turns AS MATERIALIZED (SELECT m.content_id, p.ordinal, p.turn_id, p.history_epoch
      ${sealedTurns}
      AND p.ordinal <= COALESCE((SELECT CASE WHEN anchor_ordinal + ?5 < latest_ordinal
        THEN anchor_ordinal + ?5 END FROM bounds), 9e999)
      ORDER BY p.ordinal DESC,p.turn_id DESC LIMIT ?4),
    result AS (
      SELECT 0 AS bucket_order, 'meta' AS bucket, NULL AS __payload,
        history_epoch, latest_ordinal, earliest_ordinal, 0 AS result_ordinal FROM bounds
      UNION ALL
      SELECT 1, 'turn', json_set(${historyContentPayload()}, '$.historyEpoch', t.history_epoch, '$.ordinal', t.ordinal),
        NULL, NULL, NULL, t.ordinal FROM turns t JOIN codewide_history_content c USING(content_id)
      UNION ALL
      SELECT 2, 'detail', ${historyMemberPayload}, NULL, NULL, NULL, p.ordinal
        FROM turns t CROSS JOIN codewide_history_turns p ON ${historyScope}
          AND p.history_epoch=t.history_epoch AND p.turn_id=t.turn_id
        CROSS JOIN codewide_history_members m ON m.connection_id=p.connection_id AND m.thread_id=p.thread_id
          AND m.history_epoch=p.history_epoch AND m.turn_id=p.turn_id
        CROSS JOIN codewide_history_content c ON c.content_id=m.content_id
        WHERE c.sealed=1 AND c.kind IN ('turnMeta','activity')
      UNION ALL
      SELECT 3, 'live', ${historyHeadPayload()}, NULL, NULL, NULL, 0
        FROM codewide_history_heads h JOIN codewide_history_chains g
          ON g.connection_id=h.connection_id AND g.thread_id=h.thread_id AND g.history_epoch=h.active_epoch
        WHERE h.connection_id=?1 AND h.thread_id=?2
      UNION ALL
      SELECT 3, 'live', ${historyMemberPayload}, NULL, NULL, NULL, p.ordinal FROM ${liveSource}
        WHERE ${liveScope} AND p.history_epoch=(SELECT history_epoch FROM chain)
      UNION ALL
      SELECT 3, 'live', payload, NULL, NULL, NULL, ordinal FROM codewide_history_pending
        WHERE connection_id=?1 AND thread_id=?2
    ) SELECT * FROM result ORDER BY bucket_order ASC,result_ordinal DESC`;
}
