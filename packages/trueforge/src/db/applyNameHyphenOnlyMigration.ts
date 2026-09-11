/**
 * One-time migration: change old names with `.` or `_` into hyphen-only names.
 *
 * Steps:
 * 1. Rename model providers (and model names inside their manifest).
 * 2. Rename skills and MCP servers (and their manifest.name).
 * 3. Rename schedules.
 * 4. Rename agents, then update session/schedule.agent_name to match.
 * 5. Fix agent.manifest / session.agent_spec so they still point at the new names.
 *
 * Always read JSON with dialect.readJson (especially on SQLite). Cannot undo.
 */
import { sql, type Kysely, type RawBuilder } from 'kysely';
import {
  buildRenameMap,
  planHyphenOnlyName,
  planHyphenOnlyRenames,
  rewriteAgentSpecNameRefs,
  type NameRename,
} from './planHyphenOnlyRenames';

export interface NameHyphenMigrationDialect {
  bindJson(value: unknown): RawBuilder<unknown>;
  touchUpdatedAt(): RawBuilder<unknown>;
  /** How to read a JSON column (SQLite needs json(column)). */
  readJson(column: 'manifest' | 'agent_spec'): RawBuilder<unknown>;
}

/** Log how many rows we scanned and how many we changed. */
function logRenameProgress({ kind, total, updated }: { kind: string; total: number; updated: number }): void {
  console.log(`name-hyphen-only migration [${kind}]: total=${String(total)} updated=${String(updated)}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Turn a readJson result into a plain object.
 * Postgres often gives an object; SQLite may give a JSON string. Always SELECT with
 * readJson — do not read raw binary JSON.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isPlainRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isPlainRecord(value) ? value : undefined;
}

async function rewriteAgentDocuments<TDatabase>({
  db,
  dialect,
  providers,
  models,
  mcpServers,
  skills,
}: {
  db: Kysely<TDatabase>;
  dialect: NameHyphenMigrationDialect;
  providers: ReadonlyMap<string, string>;
  models: ReadonlyMap<string, string>;
  mcpServers: ReadonlyMap<string, string>;
  skills: ReadonlyMap<string, string>;
}): Promise<{ agentManifest: number; sessionAgentSpec: number }> {
  if (providers.size === 0 && models.size === 0 && mcpServers.size === 0 && skills.size === 0) {
    return { agentManifest: 0, sessionAgentSpec: 0 };
  }

  const agents = await sql<{ id: string; tenant_id: string; manifest: unknown }>`
    SELECT id, tenant_id, ${dialect.readJson('manifest')} AS manifest FROM agent
  `.execute(db);

  let agentUpdated = 0;
  for (const row of agents.rows) {
    const manifest = asRecord(row.manifest);
    if (manifest === undefined) {
      continue;
    }
    const next = rewriteAgentSpecNameRefs({
      spec: manifest,
      tenantId: row.tenant_id,
      providers,
      models,
      mcpServers,
      skills,
    });
    if (JSON.stringify(next) === JSON.stringify(manifest)) {
      continue;
    }
    await sql`
      UPDATE agent
      SET manifest = ${dialect.bindJson(next)}, updated_at = ${dialect.touchUpdatedAt()}
      WHERE id = ${row.id}
    `.execute(db);
    agentUpdated += 1;
  }
  logRenameProgress({
    kind: 'agent.manifest',
    total: agents.rows.length,
    updated: agentUpdated,
  });

  const sessions = await sql<{ session_id: string; tenant_id: string; agent_spec: unknown }>`
    SELECT session_id, tenant_id, ${dialect.readJson('agent_spec')} AS agent_spec
    FROM session WHERE agent_spec IS NOT NULL
  `.execute(db);

  let sessionUpdated = 0;
  for (const row of sessions.rows) {
    const spec = asRecord(row.agent_spec);
    if (spec === undefined) {
      continue;
    }
    const next = rewriteAgentSpecNameRefs({
      spec,
      tenantId: row.tenant_id,
      providers,
      models,
      mcpServers,
      skills,
    });
    if (JSON.stringify(next) === JSON.stringify(spec)) {
      continue;
    }
    await sql`
      UPDATE session
      SET agent_spec = ${dialect.bindJson(next)}
      WHERE tenant_id = ${row.tenant_id} AND session_id = ${row.session_id}
    `.execute(db);
    sessionUpdated += 1;
  }
  logRenameProgress({
    kind: 'session.agent_spec',
    total: sessions.rows.length,
    updated: sessionUpdated,
  });
  return { agentManifest: agentUpdated, sessionAgentSpec: sessionUpdated };
}

async function renameSkillRows<TDatabase>({
  db,
  dialect,
  renames,
}: {
  db: Kysely<TDatabase>;
  dialect: NameHyphenMigrationDialect;
  renames: readonly NameRename[];
}): Promise<number> {
  let updated = 0;
  for (const rename of renames) {
    const rows = await sql<{ manifest: unknown }>`
      SELECT ${dialect.readJson('manifest')} AS manifest FROM skill
      WHERE tenant_id = ${rename.tenant_id} AND name = ${rename.from}
    `.execute(db);
    const manifest = asRecord(rows.rows[0]?.manifest);
    if (manifest === undefined) {
      throw new Error(`Missing skill row ${rename.tenant_id}/${rename.from} during name migration`);
    }
    await sql`
      UPDATE skill
      SET
        name = ${rename.to},
        manifest = ${dialect.bindJson({ ...manifest, name: rename.to })},
        updated_at = ${dialect.touchUpdatedAt()}
      WHERE tenant_id = ${rename.tenant_id} AND name = ${rename.from}
    `.execute(db);
    updated += 1;
  }
  return updated;
}

async function renameMcpServerRows<TDatabase>({
  db,
  dialect,
  renames,
}: {
  db: Kysely<TDatabase>;
  dialect: NameHyphenMigrationDialect;
  renames: readonly NameRename[];
}): Promise<number> {
  let updated = 0;
  for (const rename of renames) {
    const rows = await sql<{ manifest: unknown }>`
      SELECT ${dialect.readJson('manifest')} AS manifest FROM mcp_server
      WHERE tenant_id = ${rename.tenant_id} AND name = ${rename.from}
    `.execute(db);
    const manifest = asRecord(rows.rows[0]?.manifest);
    if (manifest === undefined) {
      throw new Error(`Missing mcp_server row ${rename.tenant_id}/${rename.from} during name migration`);
    }
    await sql`
      UPDATE mcp_server
      SET
        name = ${rename.to},
        manifest = ${dialect.bindJson({ ...manifest, name: rename.to })},
        updated_at = ${dialect.touchUpdatedAt()}
      WHERE tenant_id = ${rename.tenant_id} AND name = ${rename.from}
    `.execute(db);
    updated += 1;
  }
  return updated;
}

/** Rename schedule rows by id (name column only). */
async function renameScheduleRows<TDatabase>({
  db,
  dialect,
  renames,
}: {
  db: Kysely<TDatabase>;
  dialect: NameHyphenMigrationDialect;
  renames: readonly { id: string; to: string }[];
}): Promise<number> {
  let updated = 0;
  for (const rename of renames) {
    await sql`
      UPDATE schedule
      SET name = ${rename.to}, updated_at = ${dialect.touchUpdatedAt()}
      WHERE id = ${rename.id}
    `.execute(db);
    updated += 1;
  }
  return updated;
}

/** Rename agents and update matching session/schedule.agent_name. */
async function renameAgentRows<TDatabase>({
  db,
  dialect,
  renames,
}: {
  db: Kysely<TDatabase>;
  dialect: NameHyphenMigrationDialect;
  renames: readonly { id: string; tenant_id: string; from: string; to: string }[];
}): Promise<number> {
  let updated = 0;
  for (const rename of renames) {
    await sql`
      UPDATE agent
      SET name = ${rename.to}, updated_at = ${dialect.touchUpdatedAt()}
      WHERE id = ${rename.id}
    `.execute(db);
    await sql`
      UPDATE session
      SET agent_name = ${rename.to}
      WHERE tenant_id = ${rename.tenant_id} AND agent_name = ${rename.from}
    `.execute(db);
    await sql`
      UPDATE schedule
      SET agent_name = ${rename.to}
      WHERE tenant_id = ${rename.tenant_id} AND agent_name = ${rename.from}
    `.execute(db);
    updated += 1;
  }
  return updated;
}

export async function applyNameHyphenOnlyMigration<TDatabase>({
  db,
  dialect,
}: {
  db: Kysely<TDatabase>;
  dialect: NameHyphenMigrationDialect;
}): Promise<void> {
  // Step 1 — model providers (and remember renames for step 5).
  const providerRows = await sql<{ tenant_id: string; name: string; manifest: unknown }>`
    SELECT tenant_id, name, ${dialect.readJson('manifest')} AS manifest FROM model_provider
  `.execute(db);

  const providerRenames: NameRename[] = [];
  const modelRenameMap = new Map<string, string>();
  let providerUpdated = 0;
  let nestedModelsRenamed = 0;

  for (const row of providerRows.rows) {
    const providerTo = planHyphenOnlyName(row.name) ?? row.name;
    if (providerTo !== row.name) {
      providerRenames.push({ tenant_id: row.tenant_id, from: row.name, to: providerTo });
    }

    const manifest = asRecord(row.manifest);
    if (manifest === undefined) {
      continue;
    }
    const modelsValue = manifest['models'];
    let modelsChanged = false;
    let nextModels: unknown = modelsValue;
    if (Array.isArray(modelsValue)) {
      const rewritten: unknown[] = [];
      for (const raw of modelsValue) {
        const model = asRecord(raw);
        if (model === undefined || typeof model['name'] !== 'string') {
          rewritten.push(raw);
          continue;
        }
        const modelName = model['name'];
        // Model display names must follow NameSchema too.
        const modelTo = planHyphenOnlyName(modelName);
        if (modelTo === undefined) {
          rewritten.push(model);
          continue;
        }
        // Remember old→new so step 5 can fix provider/model refs.
        modelRenameMap.set(`${row.tenant_id}\0${row.name}\0${modelName}`, modelTo);
        modelsChanged = true;
        nestedModelsRenamed += 1;
        rewritten.push({ ...model, name: modelTo });
      }
      nextModels = rewritten;
    }

    const nextManifest: Record<string, unknown> = { ...manifest };
    if (modelsChanged) {
      nextManifest['models'] = nextModels;
    }
    // Custom providers also store the name inside manifest.name — keep it matching.
    if (manifest['type'] === 'custom' && typeof manifest['name'] === 'string' && providerTo !== row.name) {
      nextManifest['name'] = providerTo;
    }

    if (providerTo === row.name && !modelsChanged) {
      continue;
    }

    await sql`
      UPDATE model_provider
      SET
        name = ${providerTo},
        manifest = ${dialect.bindJson(nextManifest)},
        updated_at = ${dialect.touchUpdatedAt()}
      WHERE tenant_id = ${row.tenant_id} AND name = ${row.name}
    `.execute(db);
    providerUpdated += 1;
  }
  logRenameProgress({
    kind: 'model_provider',
    total: providerRows.rows.length,
    updated: providerUpdated,
  });
  if (nestedModelsRenamed > 0) {
    logRenameProgress({
      kind: 'model_provider.models',
      total: nestedModelsRenamed,
      updated: nestedModelsRenamed,
    });
  }

  // Step 2 — skills and MCP servers.
  const skillRows = await sql<{ tenant_id: string; name: string }>`
    SELECT tenant_id, name FROM skill
  `.execute(db);
  const skillRenames = planHyphenOnlyRenames(skillRows.rows);
  const skillUpdated = await renameSkillRows({ db, dialect, renames: skillRenames });
  logRenameProgress({
    kind: 'skill',
    total: skillRows.rows.length,
    updated: skillUpdated,
  });

  const mcpRows = await sql<{ tenant_id: string; name: string }>`
    SELECT tenant_id, name FROM mcp_server
  `.execute(db);
  const mcpRenames = planHyphenOnlyRenames(mcpRows.rows);
  const mcpUpdated = await renameMcpServerRows({ db, dialect, renames: mcpRenames });
  logRenameProgress({
    kind: 'mcp_server',
    total: mcpRows.rows.length,
    updated: mcpUpdated,
  });

  // Step 3 — schedule names (agent_name is updated in step 4).
  const scheduleRows = await sql<{ id: string; tenant_id: string; name: string }>`
    SELECT id, tenant_id, name FROM schedule
  `.execute(db);
  const scheduleRenames: { id: string; to: string }[] = [];
  for (const row of scheduleRows.rows) {
    const to = planHyphenOnlyName(row.name);
    if (to === undefined) {
      continue;
    }
    scheduleRenames.push({ id: row.id, to });
  }
  const scheduleUpdated = await renameScheduleRows({ db, dialect, renames: scheduleRenames });
  logRenameProgress({
    kind: 'schedule.name',
    total: scheduleRows.rows.length,
    updated: scheduleUpdated,
  });

  // Step 4 — agents (and session/schedule.agent_name).
  const agentRows = await sql<{ id: string; tenant_id: string; name: string }>`
    SELECT id, tenant_id, name FROM agent
  `.execute(db);
  const agentRenames: { id: string; tenant_id: string; from: string; to: string }[] = [];
  for (const row of agentRows.rows) {
    const to = planHyphenOnlyName(row.name);
    if (to === undefined) {
      continue;
    }
    agentRenames.push({ id: row.id, tenant_id: row.tenant_id, from: row.name, to });
  }
  const agentUpdated = await renameAgentRows({ db, dialect, renames: agentRenames });
  logRenameProgress({
    kind: 'agent',
    total: agentRows.rows.length,
    updated: agentUpdated,
  });

  // Step 5 — fix agent.manifest / session.agent_spec that still use old names.
  const agentSpecUpdates = await rewriteAgentDocuments({
    db,
    dialect,
    providers: buildRenameMap(providerRenames),
    models: modelRenameMap,
    mcpServers: buildRenameMap(mcpRenames),
    skills: buildRenameMap(skillRenames),
  });

  const totalUpdated =
    providerUpdated +
    nestedModelsRenamed +
    skillUpdated +
    mcpUpdated +
    scheduleUpdated +
    agentUpdated +
    agentSpecUpdates.agentManifest +
    agentSpecUpdates.sessionAgentSpec;
  if (totalUpdated === 0) {
    console.log('name-hyphen-only migration: nothing to rename');
  } else {
    console.log(
      `name-hyphen-only migration: done updated=${String(totalUpdated)} ` +
        `model_provider=${String(providerUpdated)} ` +
        `model_provider.models=${String(nestedModelsRenamed)} ` +
        `skill=${String(skillUpdated)} ` +
        `mcp_server=${String(mcpUpdated)} ` +
        `schedule.name=${String(scheduleUpdated)} ` +
        `agent=${String(agentUpdated)} ` +
        `agent.manifest=${String(agentSpecUpdates.agentManifest)} ` +
        `session.agent_spec=${String(agentSpecUpdates.sessionAgentSpec)}`,
    );
  }
}
