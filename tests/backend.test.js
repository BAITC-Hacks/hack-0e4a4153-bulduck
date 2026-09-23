const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('unified server: draft → publish → proposals → multiple decisions → restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edutask-test-'));
  let child;
  async function start() {
    child = spawn(process.execPath, ['-e', "const {server}=require('./server'); server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"], {
      cwd: path.join(__dirname, '..'), env: { ...process.env, AI_MODE: 'demo', EDUTASK_DATA_FILE: path.join(dir, 'tasks.json') }, stdio: ['ignore', 'pipe', 'pipe']
    });
    return new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stderr.on('data', data => reject(new Error(String(data))));
      child.stdout.once('data', data => resolve('http://127.0.0.1:' + String(data).trim()));
      child.once('exit', code => { if (code) reject(new Error(`Server exit ${code}`)); });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  let base = await start();
  async function call(route, method = 'GET', body, expected = 200) {
    const res = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await res.json(); assert.equal(res.status, expected, JSON.stringify(result)); return result;
  }
  assert.match(await (await fetch(base)).text(), /tasks-ui.js/);
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await call('/api/health')).ai, false);
  await call('/api/tasks/draft', 'POST', { rawDescription: 5 }, 400);
  const invalid = await fetch(base + '/api/tasks/draft', { method: 'POST', body: '{' }); assert.equal(invalid.status, 400);
  const oversized = await fetch(base + '/api/tasks/draft', { method: 'POST', body: 'x'.repeat(100001) }); assert.equal(oversized.status, 413);
  const draft = await call('/api/tasks/draft', 'POST', { rawDescription: 'Нужен интересный урок истории для школьников' }, 201);
  assert.equal(draft.questions.length, 3); assert.equal(draft.score, 0);
  const route = '/api/tasks/' + draft.id;
  await stop(); base = await start();
  assert.equal((await call(route)).rawDescription, draft.rawDescription);
  const generated = await call(route + '/generate-card', 'POST', { answers: {} });
  assert.equal(generated.demo, true); assert.equal(generated.expectedResult, ''); assert.equal(generated.contact, '');
  await call(route + '/generate-card', 'POST', { answers: {} });
  await call(route + '/publish', 'POST', {}, 400);
  const published = await call(route + '/publish', 'POST', { confirmed: true });
  assert.ok(published.score < 40);
  assert.ok((await call('/api/tasks')).tasks.some(x => x.id === draft.id));
  await call(route, 'PATCH', { title: 'Новое название' }, 400);
  const updated = await call(route, 'PATCH', { confirmed: true, title: 'Урок истории', context: 'Нужен подробный урок истории для учеников восьмого класса', users: ['8 класс'], materials: 'Учебник и материалы преподавателя', expectedResult: 'Сценарий урока с заданиями и итоговым тестом', successCriteria: ['3 задания', '10 вопросов теста'], constraints: ['45 минут'], contact: 'teacher@example.test', interactionFormat: 'Консультации по почте', score: 999 });
  assert.equal(updated.score, 100);
  assert.equal((await call('/api/tasks?level=priority')).tasks.some(x => x.id === draft.id), true);
  const proposal = { teamName: 'History Lab', idea: 'Интерактивный квест', plan: 'Сценарий, прототип, проверка', deadline: '10 дней', link: 'https://example.com/demo' };
  await call(route + '/proposals', 'POST', { ...proposal, link: 'javascript:alert(1)' }, 400);
  const offers = await Promise.all([1,2,3].map(i => call(route + '/proposals', 'POST', { ...proposal, teamName: 'Команда ' + i }, 201)));
  await call(route + '/proposals/' + offers[0].id, 'PATCH', { decision: 'accepted' });
  let task = await call(route); assert.equal(task.proposals.filter(x => x.status === 'pending').length, 2);
  await call(route + '/proposals/' + offers[1].id, 'PATCH', { decision: 'accepted' });
  await call(route + '/proposals/' + offers[2].id, 'PATCH', { decision: 'rejected' });
  await call(route + '/publish', 'POST', { confirmed: true });
  await stop(); base = await start();
  task = await call(route);
  assert.equal(task.proposals.length, 3); assert.equal(task.proposals.filter(x => x.status === 'accepted').length, 2);
  assert.equal(task.status, 'selected');
  assert.equal((await call('/api/tasks')).tasks.some(x => x.id === draft.id), true);
  await call(route + '/proposals/' + offers[0].id + '/extra', 'PATCH', { decision: 'accepted' }, 404);
  const emptyScore = await call('/api/tasks/score', 'POST', { users: [' '], constraints: [''], successCriteria: ['', ''] }); assert.equal(emptyScore.score, 0);
});
