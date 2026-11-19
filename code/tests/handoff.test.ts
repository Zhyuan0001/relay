import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEnv } from './helpers.ts';
import { ExtractionService } from '../src/application/extraction-service.ts';
import { ReviewService } from '../src/application/review-service.ts';
import { HandoffService } from '../src/application/handoff-service.ts';
import { planManagedBlock, applyWritePlan } from '../src/infrastructure/managed-block-writer.ts';

test('handoff: managed blocks preserve user content, idempotent, conflict, claim-once', () => {
  const env = createEnv();
  try {
    new ExtractionService(env.store).extract(env.workspace.id);
    const review = new ReviewService(env.store);
    review.accept(review.inbox(env.workspace.id)[0].id);
    const sessions = env.store.listSessions(env.workspace.id);
    const task = env.store.createTask({
      workspaceId: env.workspace.id,
      title: '交接测试',
      goal: '验证交接文件写入。',
      nextStep: '继续实现。',
      acceptance: '文件可读。',
    });
    for (const session of sessions) env.store.linkSession(task.id, session.id);
    const service = new HandoffService(env.store);
    const first = service.write(task.id, 'antigravity', { workspaceRoot: env.workspaceRoot });
    const agentsPath = join(env.workspaceRoot, 'AGENTS.md');
    const handoffPath = join(env.workspaceRoot, 'HANDOFF.md');
    const agents = readFileSync(agentsPath, 'utf8');
    assert.ok(agents.includes('用户内容'));
    assert.match(agents, /<!-- relay:begin habits hash=[0-9a-f]+ -->/);
    assert.match(agents, /<!-- relay:begin environment hash=[0-9a-f]+ -->/);
    const brief = readFileSync(handoffPath, 'utf8');
    assert.match(brief, /交接简报/);
    assert.match(brief, /UNTRUSTED/);

    const second = service.write(task.id, 'antigravity', { workspaceRoot: env.workspaceRoot });
    assert.equal(readFileSync(agentsPath, 'utf8'), agents);
    assert.equal(readFileSync(handoffPath, 'utf8'), brief);
    assert.equal(first.files.length, second.files.length);

    assert.equal(service.claim(first.handoff.id), false);
    assert.equal(service.claim(second.handoff.id), true);
    assert.equal(service.claim(second.handoff.id), false);

    const tampered = agents.replace(
      /(<!-- relay:begin habits hash=[0-9a-f]+ -->\n)([\s\S]*?)(<!-- relay:end habits -->)/,
      '$1手工修改\n$3',
    );
    writeFileSync(agentsPath, tampered, 'utf8');
    assert.throws(() => service.write(task.id, 'antigravity', { workspaceRoot: env.workspaceRoot }), /RELAY-E004/);

    const stalePath = join(env.workspaceRoot, 'STALE.md');
    const planA = planManagedBlock(stalePath, 'a', 'one');
    const planB = planManagedBlock(stalePath, 'b', 'two');
    applyWritePlan(planA);
    assert.throws(() => applyWritePlan(planB), /stale plan/);
  } finally {
    env.store.close();
  }
});


test('handoff: long brief keeps next/acceptance and paired untrusted markers', () => {
  const env = createEnv();
  try {
    new ExtractionService(env.store).extract(env.workspace.id);
    const review = new ReviewService(env.store);
    review.accept(review.inbox(env.workspace.id)[0].id);
    for (let i = 0; i < 15; i += 1) {
      const candidate = env.store.upsertCandidate(env.workspace.id, {
        category: 'style',
        statement: `风格规则 ${i}：保持一致的命名与格式`,
        confidence: 0.9,
        scope: 'project',
        evidenceEventIds: [],
      });
      env.store.acceptCandidate(candidate.id);
    }
    const sessions = env.store.listSessions(env.workspace.id);
    const task = env.store.createTask({
      workspaceId: env.workspace.id,
      title: '长简报测试',
      goal: '验证预算裁剪不会丢关键字段。',
      nextStep: '继续实现。',
      acceptance: '关键字段仍在。',
    });
    for (const session of sessions) env.store.linkSession(task.id, session.id);
    const result = new HandoffService(env.store).buildBrief(task.id, 'antigravity');
    assert.match(result.text, /下一步/);
    assert.match(result.text, /验收条件/);
    const starts = (result.text.match(/<<<UNTRUSTED/g) ?? []).length;
    const ends = (result.text.match(/<<<END UNTRUSTED/g) ?? []).length;
    assert.equal(starts, ends);
    assert.ok(result.tokens <= 1500, `tokens ${result.tokens}`);
  } finally {
    env.store.close();
  }
});
