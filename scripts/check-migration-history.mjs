#!/usr/bin/env node
// Read-only migration drift detector: version and secondary name comparison.
// Matching names do NOT prove SQL equivalence. Never repairs migration history.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function compareHistory(filenames, remoteInput) {
  if (!Array.isArray(remoteInput)) throw new Error("Expected migration array");
  const local = filenames.filter(x => /^\d+_.+\.sql$/.test(x)).map(filename => {
    const [,version,name] = filename.match(/^(\d+)_(.+)\.sql$/);
    return {version,name};
  });
  const remote = remoteInput.map(x => typeof x === "string" ? {version:x,name:null} : x);
  if (!remote.every(x => x && typeof x.version === "string" && /^\d+$/.test(x.version) &&
      (x.name == null || typeof x.name === "string"))) {
    throw new Error("Expected numeric migration versions and optional names");
  }
  const lv = local.map(x => x.version), rv=remote.map(x => x.version);
  const localVersions = new Set(lv), remoteVersions = new Set(rv);
  const localNames = new Set(local.map(x=>x.name));
  const exactNames = remote.filter(x => x.name != null && localNames.has(x.name));
  return {
    local_files: local.length,
    remote_versions: remote.length,
    shared_versions: [...localVersions].filter(x=>remoteVersions.has(x)).length,
    duplicated_local_versions: [...new Set(lv.filter((v,i)=>lv.indexOf(v)!==i))].sort(),
    missing_from_repo: [...remoteVersions].filter(x=>!localVersions.has(x)).sort(),
    not_recorded_remotely: [...localVersions].filter(x=>!remoteVersions.has(x)).sort(),
    same_name_count: exactNames.length,
    same_name_different_timestamp: exactNames.filter(x=>!local.some(y=>y.name===x.name&&y.version===x.version))
      .map(x=>({name:x.name,remote_version:x.version,local_version:local.find(y=>y.name===x.name).version})),
    remote_without_local_name: remote.filter(x=>x.name != null && !localNames.has(x.name))
      .map(x=>({version:x.version,name:x.name})),
    equivalence_verified: false,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  if (process.argv.length !== 3) {
    console.error("Usage: node scripts/check-migration-history.mjs <remote-migrations.json>");
    process.exit(2);
  }
  const raw=JSON.parse(readFileSync(process.argv[2],"utf8"));
  const result=compareHistory(readdirSync("supabase/migrations"),Array.isArray(raw)?raw:raw.migrations);
  console.log(JSON.stringify(result,null,2));
  if (result.duplicated_local_versions.length || result.missing_from_repo.length ||
      result.not_recorded_remotely.length) process.exitCode=1;
}
