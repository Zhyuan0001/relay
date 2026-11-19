import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEvent, sanitizeText } from '../src/infrastructure/redactor.ts';
import type { RawEvent } from '../src/domain/types.ts';

test('redacts secrets, emails, unicode home paths and proxy credentials', () => {
  const input =
    'key sk-abcdefghijklmnop1234 email a@b.com path /home/yuan/桌面/demo proxy http://user:pass@example.com';
  const { text, hits } = sanitizeText(input);
  assert.ok(!text.includes('sk-abcdefghijklmnop1234'));
  assert.ok(!text.includes('a@b.com'));
  assert.ok(text.includes('/home/<user>/桌面/demo'));
  assert.ok(text.includes('http://***@example.com'));
  assert.ok(hits.length >= 3);
});

test('sanitizes nested input objects before storage', () => {
  const event: RawEvent = {
    id: 'e1',
    sessionId: 's1',
    type: 'tool_call',
    occurredAt: new Date().toISOString(),
    tool: 'Bash',
    input: { apiKey: 'sk-abcdefghijklmnop1234', command: 'echo a@b.com' },
    provenance: { agent: 'qoder', sourcePath: '/home/yuan/桌面/x.jsonl', lineNo: 1, blockIndex: 0, occurredAt: '' },
  };
  const { event: sanitized, hits } = sanitizeEvent(event);
  const json = JSON.stringify(sanitized.input);
  assert.ok(!json.includes('sk-abcdefghijklmnop1234'));
  assert.ok(!json.includes('a@b.com'));
  assert.ok(hits.length >= 2);
});


test('redacts private keys, passwords, AWS secrets, mongo URIs and forward-slash Windows paths', () => {
  const input = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEA',
    '-----END RSA PRIVATE KEY-----',
    'password=hunter2',
    'AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz123456',
    'mongodb://user:pass@localhost/db',
    'C:/Users/yuan/secret.txt',
  ].join('\n');
  const { text } = sanitizeText(input);
  assert.ok(!text.includes('MIIEowIBAAKCAQEA'));
  assert.ok(!text.includes('hunter2'));
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(text.includes('mongodb://***@localhost/db'));
  assert.ok(text.includes('C:/Users/<user>/secret.txt'));
});
