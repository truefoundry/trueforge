import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDummyArtifactServer } from '../../src/artifacts/dummyArtifactServer';

test('lists newest first and pages with tokens', async () => {
  const server = createDummyArtifactServer();
  const first = await server.listArtifacts({ limit: 5 });
  assert.equal(first.data.length, 5);
  assert.ok(first.nextPageToken !== undefined);
  assert.equal(first.previousPageToken, undefined);
  const updated = first.data.map(artifact => artifact.updatedAt);
  assert.deepEqual([...updated].sort().reverse(), updated);

  const second = await server.listArtifacts({ limit: 5, pageToken: first.nextPageToken });
  assert.ok(second.previousPageToken !== undefined);
  assert.notEqual(second.data[0]?.slug, first.data[0]?.slug);
});

test('filters by title and reads file content', async () => {
  const server = createDummyArtifactServer();
  const { data } = await server.listArtifacts({ title: 'PRICING' });
  assert.deepEqual(
    data.map(artifact => artifact.slug),
    ['pricing-calculator'],
  );
  const blob = await server.readArtifactFile({ slug: 'pricing-calculator' });
  assert.match(await blob.text(), /Pricing calculator/);
  await assert.rejects(server.readArtifactFile({ slug: 'missing' }));
});

test('gets an artifact by id', async () => {
  const server = createDummyArtifactServer();
  const [first] = (await server.listArtifacts()).data;
  assert.ok(first !== undefined);
  assert.equal((await server.getArtifact({ id: first.id })).slug, first.slug);
  assert.ok(!first.id.includes('-'));
  await assert.rejects(server.getArtifact({ id: 'missing' }));
});

test('renames and deletes by id', async () => {
  const server = createDummyArtifactServer();
  const [first] = (await server.listArtifacts()).data;
  assert.ok(first !== undefined);
  const renamed = await server.updateArtifact({ id: first.id, title: 'Renamed brief' });
  assert.equal(renamed.title, 'Renamed brief');
  assert.equal((await server.listArtifacts({ title: 'Renamed' })).data[0]?.id, first.id);
  await server.deleteArtifact({ id: first.id });
  assert.equal((await server.listArtifacts({ title: 'Renamed' })).data.length, 0);
});

test('filters by scope against the current user', async () => {
  const server = createDummyArtifactServer();
  const mine = await server.listArtifacts({ scope: 'created_by_me', limit: 100 });
  const shared = await server.listArtifacts({ scope: 'shared_with_me', limit: 100 });
  const all = await server.listArtifacts({ limit: 100 });
  assert.ok(mine.data.length > 0 && shared.data.length > 0);
  assert.equal(mine.data.length + shared.data.length, all.data.length);
});
