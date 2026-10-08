import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const page = read('src/routes/admin/addons/+page.svelte');
const actions = read('src/routes/api/addon-library/[id]/[action]/+server.ts');
const item = read('src/routes/api/addon-library/[id]/+server.ts');
const apex = read('src/routes/api/addons/apex/[...path]/+server.ts');
const studio = read('src/routes/api/addons/studio/[...path]/+server.ts');

test('add-on lifecycle UI uses the dedicated library route, not component runtime routes', () => {
  assert.match(page, /const endpoint=`\/addon-library\/\$\{id\}\/\$\{action\}`;/);
  assert.match(page, /api\.post\(`\/addon-library\/\$\{id\}\/unlink`\)/);
  assert.match(page, /api\.delete\(`\/addon-library\/\$\{id\}`\)/);
  assert.doesNotMatch(page, /api\.(post|delete)\(`\/addons\/\$\{id\}/);
});
test('dedicated library endpoint supports every UI action', () => {
  for (const action of ['install','link','unlink','test']) {
    assert.ok(actions.includes(`action==='${action}'`), `missing ${action}`);
  }
  assert.match(item, /export async function DELETE/);
});
test('component runtime catchalls remain licensed and separate', () => {
  assert.match(apex, /assertComponentLicensed\('orbitfs_apex'\)/);
  assert.match(studio, /assertComponentLicensed\('orbitfs_studio'\)/);
});
