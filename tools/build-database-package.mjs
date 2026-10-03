import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const ROOT=resolve(process.cwd());
const args=process.argv.slice(2);
const arg=(name,fallback='')=>{const i=args.indexOf('--'+name);return i>=0?String(args[i+1]||fallback):fallback;};
const sourceCommit=arg('commit',process.env.GITHUB_SHA||'').trim().toLowerCase();
const schemaVersionRaw=arg('schema-version',process.env.ORBITFS_SCHEMA_VERSION||'').trim();
const output=resolve(ROOT,arg('output','database-package-base.json'));
const snapshotPath=resolve(ROOT,arg('snapshot','supabase/customer-schema.sql'));
const metadataPath=resolve(ROOT,arg('metadata','orbitfs-database-schema.json'));

if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw new Error('A full 40-character source commit is required');

const dir=resolve(ROOT,'supabase/migrations');
if(!existsSync(dir)||!statSync(dir).isDirectory())throw new Error('supabase/migrations is missing');

const files=readdirSync(dir)
  .filter((name)=>/^\d{14}_[A-Za-z0-9._-]+\.sql$/.test(name))
  .sort((a,b)=>a.localeCompare(b));
if(!files.length)throw new Error('Base has no customer migrations');

const migrations=files.map((name)=>{
  const bytes=readFileSync(resolve(dir,name));
  if(bytes.length<1||bytes.length>2*1024*1024)throw new Error('Invalid migration size: '+name);
  const sql=bytes.toString('utf8');
  if(/\b(?:begin|commit|rollback)\s*;/i.test(sql))throw new Error('Explicit transaction control is not allowed: '+name);
  const stem=name.slice(0,-4);
  return {
    id:'base.'+stem,
    file:'supabase/migrations/'+name,
    component:'base',
    encoding:'base64',
    data:bytes.toString('base64'),
    size:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex')
  };
});

let snapshot=null;
let componentBoundary=null;
if(existsSync(metadataPath)&&statSync(metadataPath).isFile()){
  const metadata=JSON.parse(readFileSync(metadataPath,'utf8'));
  if(metadata?.componentBoundary?.format==='orbitfs-database-component-boundary-v1'){
    componentBoundary=metadata.componentBoundary;
  }
}
if(existsSync(snapshotPath)&&statSync(snapshotPath).isFile()){
  const bytes=readFileSync(snapshotPath);
  if(bytes.length){
    snapshot={
      format:'sql',
      file:'supabase/customer-schema.sql',
      encoding:'base64',
      data:bytes.toString('base64'),
      size:bytes.length,
      sha256:createHash('sha256').update(bytes).digest('hex')
    };
  }
}

const configuredSchemaVersion=Number(schemaVersionRaw);
const databaseSchemaVersion=Number.isInteger(configuredSchemaVersion)&&configuredSchemaVersion>0
  ? configuredSchemaVersion
  : migrations.length;

const payload={
  format:'orbitfs-customer-database-package-v1',
  packageVersion:1,
  component:'base',
  databaseTarget:'customer',
  sourceRepo:'remipetrovich-design/OrbitFS-Base-System',
  sourceCommit,
  databaseSchemaVersion,
  minimumBaseSchemaVersion:null,
  minimumBaseVersion:null,
  migrationCount:migrations.length,
  migrations,
  ...(snapshot?{snapshot}:{}),
  ...(componentBoundary?{componentBoundary}:{})
};

writeFileSync(output,JSON.stringify(payload,null,2)+'\n');
console.log(JSON.stringify({
  ok:true,
  component:'base',
  databaseSchemaVersion,
  migrationCount:migrations.length,
  snapshot:Boolean(snapshot),
  output:relative(ROOT,output).replaceAll('\\','/')
},null,2));