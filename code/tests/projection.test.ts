import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEnv } from './helpers.ts';
import { ExtractionService } from '../src/application/extraction-service.ts';
import { ReviewService } from '../src/application/review-service.ts';
import { ProjectionService } from '../src/application/projection-service.ts';

test('projection: plans all agent files, preserves user content and is idempotent', () => {
  const env = createEnv();
  try {
    new ExtractionService(env.store).extract(env.workspace.id);
    const review = new ReviewService(env.store);
    review.accept(review.inbox(env.workspace.id)[0].id);
    const service = new ProjectionService(env.store);
    const plans = service.plan(env.workspace.id);
    const paths = plans.map((entry) => entry.target.path);
    for (const expected of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CONVENTIONS.md', '.cursor/rules/relay.mdc', '.clinerules/relay.md', '.roo/rules/relay.md']) {
      assert.ok(paths.includes(expected), `missing ${expected}`);
    }
    const results = service.apply(env.workspace.id);
    assert.ok(results.some((item) => item.path === 'AGENTS.md' && item.changed));
    const agents = readFileSync(join(env.workspaceRoot, 'AGENTS.md'), 'utf8');
    assert.match(agents, /用户内容/);
    assert.match(agents, /relay:begin relay-profile/);
    assert.ok(existsSync(join(env.workspaceRoot, '.cursor/rules/relay.mdc')));
    const after = service.plan(env.workspace.id);
    assert.ok(after.every((entry) => !entry.plan.changed), 'projection should be idempotent');
  } finally {
    env.store.close();
  }
});
