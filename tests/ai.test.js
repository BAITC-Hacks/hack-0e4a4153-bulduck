const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('AI contract and explicit fallback; no external requests', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edutask-ai-test-'));
  process.env.EDUTASK_DATA_FILE = path.join(dir, 'tasks.json');
  process.env.AI_MODE = 'live';
  process.env.OPENAI_API_KEY = 'test-only';
  const { safeAI } = require('../server');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let requestBody;
  const mock = t.mock.method(global, 'fetch', async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [{ question: 'Вопрос один?', answer: 'Можно сделать квиз.' }, { question: 'Вопрос два?', answer: 'Нужно уточнить.' }] }) } }] }) };
  });
  const response = await safeAI('/api/questions', { draft: 'Нужен урок истории для восьмого класса' });
  assert.equal(response.questions.length, 3); assert.equal(response.demo, undefined);
  assert.equal(response.questions[0].answer, 'Можно сделать квиз.');
  assert.ok(response.questions.every(x => typeof x.question === 'string' && typeof x.answer === 'string'));
  assert.equal(requestBody.response_format.json_schema.strict, true);
  for (const json of [ { choices: [{ finish_reason: 'length' }] }, { choices: [{ finish_reason: 'stop', message: { refusal: 'no' } }] }, { choices: [{ finish_reason: 'stop', message: { content: '{' } }] }, { choices: [{ finish_reason: 'stop', message: { content: '{"questions":17}' } }] } ]) {
    mock.mock.mockImplementation(async () => ({ ok: true, json: async () => json }));
    const fallback = await safeAI('/api/questions', { draft: 'Нужен урок истории для восьмого класса' });
    assert.equal(fallback.demo, true); assert.equal(fallback.questions.length, 3); assert.ok(fallback.warning);
  }
  mock.mock.mockImplementation(async () => ({ ok: false, status: 429 }));
  assert.equal((await safeAI('/api/generate', { draft: 'Нужен урок истории' })).demo, true);
  mock.mock.mockImplementation(async () => { throw new Error('timeout'); });
  assert.equal((await safeAI('/api/review', { title: 'Урок' })).demo, true);
  await assert.rejects(safeAI('/api/questions', null), error => error.status === 400);
});
