// Optional headless Chromium smoke test. No npm dependencies or paid AI requests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const executable = process.env.EDUTASK_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(file => fs.existsSync(file));
if (!executable) throw new Error('Set EDUTASK_BROWSER to a Chromium executable');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edutask-browser-'));
process.env.AI_MODE = 'demo';
process.env.EDUTASK_DATA_FILE = path.join(dir, 'tasks.json');
const { server } = require('../server');
let browser, socket, serial = 0;
const pending = new Map(), errors = [];
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: value => { clearTimeout(timer); reject(value); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = spawn(executable, ['--headless=new', '--no-first-run', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + path.join(dir, 'profile'), 'about:blank'], { stdio: 'ignore' });
  browser.on('error', error => errors.push(error.message));
  const portFile = path.join(dir, 'profile', 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await delay(100);
  if (!fs.existsSync(portFile)) throw new Error('Browser did not start: ' + errors.join('; '));
  const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(data.params.exceptionDetails));
    const waiting = pending.get(data.id);
    if (waiting) { pending.delete(data.id); data.error ? waiting.reject(new Error(data.error.message)) : waiting.resolve(data.result); }
  });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function wait(expression) {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(50); }
    throw new Error('UI condition failed: ' + expression);
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = (selector, value) => evaluate(`{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await send('Page.navigate', { url: base }, sessionId);
  await wait("document.querySelector('#confirmCard') && document.querySelector('.catalog-grid .task-card')");
  await click('#fillExample'); await click('#nextButton');
  await wait("document.querySelector('#stepTwo').classList.contains('active-step') && !document.querySelector('#nextButton').disabled");
  assert.equal(await evaluate("document.querySelectorAll('.question-fields textarea').length"), 3);
  await click('#nextButton');
  await wait("document.querySelector('#stepThree').classList.contains('active-step') && !document.querySelector('#nextButton').disabled");
  await fill('#taskTitle', 'Браузерная проверка урока');
  await fill('#taskResult', 'Готовый сценарий урока с заданиями и тестом');
  await fill('#taskCriteria', '3 задания\n10 вопросов');
  await fill('#taskContact', 'teacher@example.test');
  await fill('#taskInteraction', 'Консультация по почте');
  await wait("document.querySelector('#stepThree').innerText.includes('Готовность: 100 / 100')");
  await click('#confirmCard'); await click('#nextButton');
  await wait("!document.querySelector('#catalogView').classList.contains('hidden') && document.querySelector('.catalog-grid').innerText.includes('Браузерная проверка урока')");
  await fill('#demoRole', 'team');
  await evaluate("Array.from(document.querySelectorAll('.task-card')).find(x=>x.innerText.includes('Браузерная проверка урока')).querySelector('button').click()");
  await wait("document.querySelector('dialog[open] input[name=teamName]')");
  for (const [key, value] of Object.entries({ teamName: 'Browser Team', idea: 'Сделаем квест', plan: 'Сценарий, прототип, проверка', deadline: '10 дней', link: 'https://example.com/demo' })) await fill(`[name=${key}]`, value);
  await evaluate("document.querySelector('dialog form').requestSubmit()");
  await wait("document.querySelector('dialog').innerText.includes('Browser Team')");
  await click('.dialog-close'); await fill('#demoRole', 'teacher');
  await evaluate("Array.from(document.querySelectorAll('.task-card')).find(x=>x.innerText.includes('Браузерная проверка урока')).querySelector('button').click()");
  await wait("document.querySelector('dialog[open]') && Array.from(document.querySelectorAll('dialog button')).some(x=>x.textContent==='Принять')");
  await evaluate("Array.from(document.querySelectorAll('dialog button')).find(x=>x.textContent==='Принять').click()");
  await wait("document.querySelector('dialog').innerText.includes('Принято')");
  await evaluate("Array.from(document.querySelectorAll('dialog button')).find(x=>x.textContent==='Редактировать задачу').click()");
  await wait("document.querySelectorAll('dialog textarea').length===12");
  await evaluate("{const form=document.querySelector('dialog form');form.querySelectorAll('textarea')[5].value='';form.querySelector('input[type=checkbox]').checked=true;form.requestSubmit();}");
  await wait("document.querySelector('dialog').innerText.includes('Готовность: 80 / 100')");
  await send('Page.reload', {}, sessionId);
  await wait("document.querySelector('.catalog-grid')?.innerText.includes('Браузерная проверка урока')");
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: create, score, publish, propose, accept, edit, reload.');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch {}
    socket.close();
  }
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(2000)]);
    if (browser.exitCode === null) browser.kill();
  }
  await new Promise(resolve => server.close(resolve));
  // Only this test's mkdtemp directory is removed; user data lives elsewhere.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});
