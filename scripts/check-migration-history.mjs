#!/usr/bin/env node
// Read-only migration drift detector. Input: JSON array of remote migration
// versions or {"migrations":[{"version":"..."}]}; never repairs history.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function compareHistory(filenames, remoteVersions) {
  const local = filenames.filter(x => /^\d+_.+\.sql$/.test(x))
    .map(x => x.match(/^\d+/)[0]);
  if (!Array.isArray(remoteVersions) || !remoteVersions.every(x => typeof x === "string" && /^\d+$/.test(x))) {
    throw new Error("Expected an array of numeric migration versions");
  }
  const localSet = new Set(local), remoteSet = new Set(remoteVersions);
  return {
    local_files: local.length,
    remote_versions: remoteVersions.length,
    shared_versions: [...localSet].filter(x => remoteSet.has(x)).length,
    duplicated_local_versions: [...new Set(local.filter((v,i) => local.indexOf(v) !== i))].sort(),
    missing_from_repo: [...remoteSet].filter(x => !localSet.has(x)).sort(),
    not_recorded_remotely: [...localSet].filter(x => !remoteSet.has(x)).sort(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/check-migration-history.mjs <remote-migrations.json>");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const records = Array.isArray(raw) ? raw : raw.migrations;
  const versions = records.map(x => typeof x === "string" ? x : x.version);
  const filenames = readdirSync("supabase/migrations");
  const result = compareHistory(filenames, versions);
  console.log(JSON.stringify(result,null,2));
  if (result.duplicated_local_versions.length || result.missing_from_repo.length || result.not_recorded_remotely.length) process.exitCode = 1;
}
