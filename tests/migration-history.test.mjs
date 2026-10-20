import { test } from "node:test";
import assert from "node:assert/strict";
import { compareHistory } from "../scripts/check-migration-history.mjs";

test("identical versions have no drift", () => {
  const result = compareHistory(["20260101000000_one.sql"], ["20260101000000"]);
  assert.equal(result.shared_versions, 1);
  assert.deepEqual(result.missing_from_repo, []);
  assert.deepEqual(result.not_recorded_remotely, []);
});
test("duplicate local version is detected", () => {
  const result = compareHistory(["20260101000000_one.sql","20260101000000_two.sql"],["20260101000000"]);
  assert.deepEqual(result.duplicated_local_versions, ["20260101000000"]);
});
test("both directions of drift are detected", () => {
  const result = compareHistory(["20260101000000_one.sql"], ["20260102000000"]);
  assert.deepEqual(result.missing_from_repo, ["20260102000000"]);
  assert.deepEqual(result.not_recorded_remotely, ["20260101000000"]);
});
test("invalid remote records are rejected", () => {
  assert.throws(() => compareHistory([], ["main"]), /numeric migration/);
});
