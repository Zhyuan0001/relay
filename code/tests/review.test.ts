import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnv } from './helpers.ts';
import { ExtractionService } from '../src/application/extraction-service.ts';
import { ReviewService } from '../src/application/review-service.ts';

test('review: accept creates versions, rollback restores, ignore removes from inbox', () => {
  const env = createEnv();
  try {
    new ExtractionService(env.store).extract(env.workspace.id);
    const review = new ReviewService(env.store);
    const pending = review.inbox(env.workspace.id);
    assert.ok(pending.length >= 2);
    const first = pending[0];
    const accepted = review.accept(first.id);
    assert.equal(accepted.version.versionNo, 1);
    const acceptedAgain = review.accept(first.id);
    assert.equal(acceptedAgain.version.versionNo, 2);
    assert.equal(review.versions(accepted.item.id).length, 2);

    review.rollback(accepted.item.id, 1);
    const item = review.dossier(env.workspace.id).find((entry) => entry.id === accepted.item.id);
    assert.equal(item?.statement, first.statement);
    const version3 = review.accept(first.id);
    assert.equal(version3.version.versionNo, 3);

    const second = review.inbox(env.workspace.id)[0];
    review.ignore(second.id);
    assert.ok(!review.inbox(env.workspace.id).some((entry) => entry.id === second.id));
  } finally {
    env.store.close();
  }
});
