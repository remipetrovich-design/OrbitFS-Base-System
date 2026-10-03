import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? String(args[index + 1] || fallback) : fallback;
};

function readSchemaVersion() {
  const explicit = String(arg('schema-version', process.env.ORBITFS_SCHEMA_VERSION || '')).trim();
  if (explicit) return explicit;
  const envPath = resolve(ROOT, '.env.example');
  if (!existsSync(envPath)) return '2';
  const match = readFileSync(envPath, 'utf8').match(/^ORBITFS_SCHEMA_VERSION=(.+)$/m);
  return String(match?.[1] || '1').trim().replace(/^["']|["']$/g, '') || '1';
}

const migrationDir = resolve(ROOT, 'supabase/migrations');
if (!existsSync(migrationDir)) throw new Error('supabase/migrations is required for Base customer database packaging.');

const names = readdirSync(migrationDir)
  .filter((name) => /^\d{14}_[A-Za-z0-9._-]+\.sql$/.test(name))
  .sort((a, b) => a.localeCompare(b));

if (!names.length) throw new Error('At least one timestamped Base database migration is required.');

const migrations = names.map((name) => {
  const path = resolve(migrationDir, name);
  const data = readFileSync(path);
  if (!data.byteLength) throw new Error(`Database migration is empty: ${name}`);
  return {
    id: name.slice(0, 14),
    file: `supabase/migrations/${name}`,
    data,
    size: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex')
  };
});

const duplicateIds = migrations.filter((migration, index) =>
  migrations.findIndex((candidate) => candidate.id === migration.id) !== index
);
if (duplicateIds.length) throw new Error(`Duplicate Base migration timestamp: ${duplicateIds[0].id}`);

// Fresh-install dependency check. Migrations remain immutable; this fails packaging
// if a new migration assumes an OrbitFS table/function exists before it is created.
// Only top-level SQL is inspected. Quoted strings, comments and dollar-quoted
// PL/pgSQL bodies may legitimately contain dynamic DDL text and must not be
// interpreted as statements in the migration dependency graph.
function dependencyScanSql(input) {
  const chars = [...input];
  const mask = (startIndex, endIndex) => {
    for (let index = startIndex; index < endIndex; index += 1) {
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
    }
  };

  let index = 0;
  while (index < input.length) {
    if (input.startsWith('--', index)) {
      const endIndex = input.indexOf('\n', index + 2);
      const stop = endIndex < 0 ? input.length : endIndex;
      mask(index, stop);
      index = stop;
      continue;
    }

    if (input.startsWith('/*', index)) {
      const endIndex = input.indexOf('*/', index + 2);
      const stop = endIndex < 0 ? input.length : endIndex + 2;
      mask(index, stop);
      index = stop;
      continue;
    }

    if (input[index] === "'") {
      const startIndex = index;
      index += 1;
      while (index < input.length) {
        if (input[index] === "'" && input[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (input[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      mask(startIndex, index);
      continue;
    }

    if (input[index] === '$') {
      const rest = input.slice(index);
      const match = rest.match(/^\$\$|^\$[A-Za-z_][A-Za-z0-9_]*\$/);
      const tag = match?.[0] || '';
      if (tag) {
        const startIndex = index;
        const closeIndex = input.indexOf(tag, index + tag.length);
        index = closeIndex < 0 ? input.length : closeIndex + tag.length;
        mask(startIndex, index);
        continue;
      }
    }

    index += 1;
  }

  return chars.join('');
}

const createdTables = new Set();
const createdFunctions = new Set();
const allowedLegacyFunctions = new Set(['public.rls_auto_enable']);
for (const migration of migrations) {
  const sql = migration.data.toString('utf8');
  const scanSql = dependencyScanSql(sql);
  const events = [];
  const pushMatches = (regex, type) => {
    for (const match of scanSql.matchAll(regex)) events.push({ index: match.index ?? 0, type, match });
  };
  pushMatches(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_.]+)/ig, 'create_table');
  pushMatches(/create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(/ig, 'create_function');
  pushMatches(/alter\s+table\s+([a-z0-9_.]+)/ig, 'alter_table');
  pushMatches(/alter\s+function\s+([a-z0-9_.]+)\s*\(/ig, 'alter_function');
  pushMatches(/(?:revoke|grant)\s+[\s\S]*?\s+on\s+function\s+([a-z0-9_.]+)\s*\(/ig, 'function_privilege');
  events.sort((a, b) => a.index - b.index);

  for (const event of events) {
    const object = String(event.match[1] || '').toLowerCase();
    if (event.type === 'create_table') createdTables.add(object);
    else if (event.type === 'create_function') createdFunctions.add(object);
    else if (event.type === 'alter_table') {
      if (!createdTables.has(object) && !object.startsWith('storage.') && !object.startsWith('auth.')) {
        throw new Error(`Fresh-install dependency failure in ${migration.file}: ALTER TABLE references ${object} before it is created.`);
      }
    } else if (event.type === 'alter_function' || event.type === 'function_privilege') {
      if (!createdFunctions.has(object) && !allowedLegacyFunctions.has(object)) {
        throw new Error(`Fresh-install dependency failure in ${migration.file}: ${event.type} references ${object} before it is created.`);
      }
    }
  }
}

const compatibilityPrelude = [
  '-- Fresh-install compatibility shim for legacy rls_auto_enable revoke migrations.',
  'do $$',
  'begin',
  "  if to_regprocedure('public.rls_auto_enable()') is null then",
  "    execute 'create function public.rls_auto_enable() returns void language plpgsql as ''begin null; end''';",
  "    comment on function public.rls_auto_enable() is 'orbitfs-snapshot-compat';",
  '  end if;',
  'end',
  '$$;',
  ''
].join('\n');

const componentBoundary = {
  format: 'orbitfs-database-component-boundary-v1',
  freshInstallOnly: true,
  owner: 'base',
  excludedComponents: ['engine-shared', 'mcp', 'apex', 'studio'],
  excludedTablePrefixes: ['mcp_', 'apex_', 'studio_'],
  excludedRoutinePrefixes: ['mcp_', 'apex_', 'studio_', 'orbitfs_mcp_', 'orbitfs_apex_', 'orbitfs_studio_'],
  legacyMigrationHistoryRetained: true
};

const componentBoundaryCleanup = [
  '',
  '-- OrbitFS fresh-install component boundary.',
  '-- Historical migrations above remain immutable lineage. This cleanup is part of',
  '-- the composed fresh-install Base snapshot only and is never a forward migration.',
  '-- Engine/add-on schema is installed later from the central database registry.',
  "do language plpgsql 'declare item record; begin for item in select schemaname, viewname as object_name from pg_views where schemaname=''public'' and (left(viewname,4)=''mcp_'' or left(viewname,5)=''apex_'' or left(viewname,7)=''studio_'') loop execute format(''drop view if exists %I.%I cascade'', item.schemaname, item.object_name); end loop; for item in select schemaname, matviewname as object_name from pg_matviews where schemaname=''public'' and (left(matviewname,4)=''mcp_'' or left(matviewname,5)=''apex_'' or left(matviewname,7)=''studio_'') loop execute format(''drop materialized view if exists %I.%I cascade'', item.schemaname, item.object_name); end loop; for item in select schemaname, tablename as object_name from pg_tables where schemaname=''public'' and (left(tablename,4)=''mcp_'' or left(tablename,5)=''apex_'' or left(tablename,7)=''studio_'') loop execute format(''drop table if exists %I.%I cascade'', item.schemaname, item.object_name); end loop; for item in select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.prokind from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=''public'' and (left(p.proname,4)=''mcp_'' or left(p.proname,5)=''apex_'' or left(p.proname,7)=''studio_'' or left(p.proname,12)=''orbitfs_mcp_'' or left(p.proname,13)=''orbitfs_apex_'' or left(p.proname,15)=''orbitfs_studio_'') loop if item.prokind=''p'' then execute format(''drop procedure if exists %I.%I(%s) cascade'',item.schema_name,item.proname,item.args); else execute format(''drop function if exists %I.%I(%s) cascade'',item.schema_name,item.proname,item.args); end if; end loop; end';",
  ''
].join('\n');

const compatibilityCleanup = [
  '',
  '-- Remove only the compatibility shim created above; preserve any real pre-existing function.',
  'do $$',
  'begin',
  "  if to_regprocedure('public.rls_auto_enable()') is not null",
  "     and obj_description(to_regprocedure('public.rls_auto_enable()'), 'pg_proc') = 'orbitfs-snapshot-compat' then",
  "    execute 'drop function public.rls_auto_enable()';",
  '  end if;',
  'end',
  '$$;',
  ''
].join('\n');

const header = [
  '-- OrbitFS Base customer database snapshot',
  '-- Generated deterministically from supabase/migrations.',
  '-- Do not edit this snapshot directly; edit/add migrations and rebuild it.',
  `-- Migration count: ${migrations.length}`,
  `-- Latest migration: ${migrations[migrations.length - 1].id}`,
  ''
].join('\n');

function normalizeFreshInstallMigrationSql(input, migrationFile) {
  let sql = String(input || '').replace(/\r\n/g, '\n');
  sql = sql.replace(
    /on\s+conflict\s*\(\s*workspace_id\s*,\s*user_id\s*\)\s+do\s+nothing/ig,
    'on conflict do nothing'
  );
  sql = sql.replace(
    /alter\s+table\s+([a-z0-9_.]+)\s+add\s+constraint\s+([a-z0-9_]+)\s+unique\s*\(([^;]+)\)\s*;/ig,
    (_match, tableName, constraintName, columns) => {
      const parts = String(tableName).split('.');
      const schemaName = parts.length > 1 ? parts[0] : 'public';
      return [
        `alter table ${tableName} drop constraint if exists ${constraintName};`,
        `drop index if exists ${schemaName}.${constraintName};`,
        `alter table ${tableName} add constraint ${constraintName} unique (${String(columns).trim()});`
      ].join('\n');
    }
  );
  return sql;
}

const normalizedMigrations = migrations.map((migration) => ({
  ...migration,
  snapshotSql: normalizeFreshInstallMigrationSql(migration.data.toString('utf8'), migration.file)
}));

const body = normalizedMigrations.map((migration) => [
  `-- >>> BEGIN ${migration.file}`,
  migration.snapshotSql.trimEnd(),
  `-- <<< END ${migration.file}`,
  ''
].join('\n')).join('\n');

const sql = `${header}\n${compatibilityPrelude}\n${body}\n${compatibilityCleanup}\n${componentBoundaryCleanup}`.replace(/\r\n/g, '\n');

if (/on\s+conflict\s*\(\s*workspace_id\s*,\s*user_id\s*\)\s+do\s+nothing/i.test(sql)) {
  throw new Error('Fresh-install snapshot still contains the obsolete profile-state conflict target.');
}
const unsafeUniqueAdds = [...sql.matchAll(/alter\s+table\s+([a-z0-9_.]+)\s+add\s+constraint\s+([a-z0-9_]+)\s+unique\s*\(/ig)]
  .filter((match) => {
    const before = sql.slice(Math.max(0, (match.index || 0) - 300), match.index || 0).toLowerCase();
    return !before.includes(`drop constraint if exists ${String(match[2]).toLowerCase()}`);
  });
if (unsafeUniqueAdds.length) {
  throw new Error(`Fresh-install snapshot contains a non-replay-safe UNIQUE constraint: ${unsafeUniqueAdds[0][2]}`);
}
const requiredTables = [
  'orbitfs_users',
  'orbitfs_workspaces',
  'orbitfs_workspace_members',
  'orbitfs_files',
  'orbitfs_settings',
  'orbitfs_license',
  'orbitfs_addons',
  'orbitfs_audit_log'
];
for (const table of requiredTables) {
  if (!sql.includes(table)) throw new Error(`Generated customer schema is missing required Base table: ${table}`);
}

const outputPath = resolve(ROOT, arg('output', 'supabase/customer-schema.sql'));
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, sql);

const schemaVersion = readSchemaVersion();
const sha256 = createHash('sha256').update(Buffer.from(sql)).digest('hex');
const migrationInventory = migrations.map(({ id, file, size, sha256 }) => ({
  id,
  file,
  size,
  sha256,
  checksum: `sha256:${sha256}`
}));
const migrationChain = {
  format: 'orbitfs-base-migration-chain-v1',
  complete: true,
  baseline: true,
  lineageMode: 'authoritative-baseline',
  predecessorTracking: 'legacy-untracked',
  rootMigration: migrationInventory[0].id,
  rootSha256: migrationInventory[0].sha256,
  latestMigration: migrationInventory[migrationInventory.length - 1].id,
  migrationCount: migrationInventory.length,
  migrations: migrationInventory
};
const metadata = {
  format: 'orbitfs-base-database-snapshot-v1',
  provider: 'supabase',
  schemaVersion,
  path: 'supabase/customer-schema.sql',
  sha256,
  migrationCount: migrationInventory.length,
  migrationRoot: migrationChain.rootMigration,
  migrationRootSha256: migrationChain.rootSha256,
  latestMigration: migrationChain.latestMigration,
  migrations: migrationInventory,
  migrationChain,
  componentBoundary
};

const metadataArg = arg('metadata', '');
if (metadataArg) {
  const metadataPath = resolve(ROOT, metadataArg);
  mkdirSync(dirname(metadataPath), { recursive: true });
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
}

console.log(JSON.stringify({ ok: true, ...metadata }, null, 2));