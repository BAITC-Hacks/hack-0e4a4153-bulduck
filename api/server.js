const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { calculateScore } = require('./scoring');

const port = Number(process.env.PORT || 3000);
const dataPath = path.join(__dirname, '..', 'data', 'tasks.json');
const drafts = new Map();

function readTasks() {
  return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
}

function writeTasks(tasks) {
  fs.writeFileSync(dataPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS'
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (error) { reject(new Error('Некорректный JSON')); }
    });
    request.on('error', reject);
  });
}

function createQuestions(rawDescription) {
  const base = rawDescription || 'описание задачи';
  return {
    id: `task-${crypto.randomUUID()}`,
    status: 'draft',
    rawDescription: base,
    questions: [
      'Для какого уровня подготовки и аудитории нужна задача?',
      'Какой формат решения будет наиболее полезен?',
      'Какие материалы, сроки и технические ограничения нужно учесть?'
    ]
  };
}

function createCard(draft, answers) {
  const users = Array.isArray(answers.users) ? answers.users : [answers.users].filter(Boolean);
  const constraints = Array.isArray(answers.constraints) ? answers.constraints : [answers.constraints].filter(Boolean);
  const card = {
    id: draft.id,
    title: answers.title || `${answers.format || 'Образовательный проект'} по предмету «${answers.subject || 'образование'}»`,
    context: `${draft.rawDescription}\n\nЦелевая аудитория: ${users.join(', ')}.`,
    users,
    subject: answers.subject || '',
    format: answers.format || '',
    materials: answers.materials || '',
    constraints,
    expectedResult: answers.expectedResult || `Готовый ${answers.format || 'образовательный материал'} для выбранной аудитории.`,
    successCriteria: Array.isArray(answers.successCriteria) ? answers.successCriteria : [],
    deadline: answers.deadline || '',
    contact: answers.contact || 'Онлайн-консультация с преподавателем',
    status: 'draft'
  };
  return { ...card, ...calculateScore(card) };
}

function findTask(tasks, taskId) {
  return tasks.find((task) => task.id === taskId);
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});

  const url = new URL(request.url, `http://${request.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { status: 'ok', service: 'edutask-api' });
  }

  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    let tasks = readTasks().filter((task) => task.status !== 'draft');
    if (url.searchParams.get('subject')) tasks = tasks.filter((task) => task.subject === url.searchParams.get('subject'));
    if (url.searchParams.get('level')) tasks = tasks.filter((task) => task.level === url.searchParams.get('level'));
    if (url.searchParams.get('sort') === 'score') tasks.sort((a, b) => b.score - a.score);
    return sendJson(response, 200, { tasks });
  }

  if (request.method === 'POST' && url.pathname === '/api/tasks/draft') {
    const body = await readBody(request);
    if (!body.rawDescription || body.rawDescription.trim().length < 15) {
      return sendJson(response, 400, { error: 'Описание должно содержать минимум 15 символов' });
    }
    const draft = createQuestions(body.rawDescription.trim());
    drafts.set(draft.id, draft);
    return sendJson(response, 201, draft);
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'tasks' && parts[3] === 'generate-card') {
    const taskId = parts[2];
    const draft = drafts.get(taskId);
    if (!draft) return sendJson(response, 404, { error: 'Черновик не найден или сервер был перезапущен' });
    const body = await readBody(request);
    const card = createCard(draft, body.answers || {});
    drafts.set(taskId, card);
    return sendJson(response, 200, card);
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'tasks' && parts[3] === 'publish') {
    const taskId = parts[2];
    const draft = drafts.get(taskId);
    if (!draft) return sendJson(response, 404, { error: 'Черновик не найден или сервер был перезапущен' });
    if (!draft.title || !draft.context || draft.score < 40) return sendJson(response, 422, { error: 'Задача недостаточно заполнена для публикации', score: draft.score, missingInformation: draft.missingInformation });
    const tasks = readTasks().filter((task) => task.id !== taskId);
    const publishedTask = { ...draft, status: 'published', publishedAt: new Date().toISOString(), proposals: [] };
    tasks.push(publishedTask);
    writeTasks(tasks);
    drafts.set(taskId, publishedTask);
    return sendJson(response, 201, publishedTask);
  }

  if (request.method === 'POST' && parts[0] === 'api' && parts[1] === 'tasks' && parts[3] === 'proposals') {
    const tasks = readTasks();
    const task = findTask(tasks, parts[2]);
    if (!task) return sendJson(response, 404, { error: 'Задача не найдена' });
    const body = await readBody(request);
    if (!body.teamName || !body.idea || !body.plan || !body.deadline) return sendJson(response, 400, { error: 'Нужны название команды, идея, план и срок' });
    const proposal = { id: `proposal-${crypto.randomUUID()}`, teamName: body.teamName, idea: body.idea, plan: body.plan, deadline: body.deadline, link: body.link || '', status: 'pending', createdAt: new Date().toISOString() };
    task.proposals = [...(task.proposals || []), proposal];
    task.status = 'in_review';
    writeTasks(tasks);
    return sendJson(response, 201, proposal);
  }

  if (request.method === 'PATCH' && parts[0] === 'api' && parts[1] === 'tasks' && parts[3] === 'proposals' && parts[4]) {
    const tasks = readTasks();
    const task = findTask(tasks, parts[2]);
    if (!task) return sendJson(response, 404, { error: 'Задача не найдена' });
    const body = await readBody(request);
    if (!['accepted', 'rejected'].includes(body.decision)) return sendJson(response, 400, { error: 'decision должен быть accepted или rejected' });
    const proposal = (task.proposals || []).find((item) => item.id === parts[4]);
    if (!proposal) return sendJson(response, 404, { error: 'Предложение не найдено' });
    proposal.status = body.decision;
    if (body.decision === 'accepted') {
      task.status = 'selected';
      task.proposals.forEach((item) => { if (item.id !== proposal.id && item.status === 'pending') item.status = 'rejected'; });
    }
    writeTasks(tasks);
    return sendJson(response, 200, { task, proposal });
  }

  if (request.method === 'GET' && parts[0] === 'api' && parts[1] === 'tasks' && parts[2]) {
    const task = readTasks().find((item) => item.id === parts[2]);
    return task ? sendJson(response, 200, task) : sendJson(response, 404, { error: 'Задача не найдена' });
  }

  return sendJson(response, 404, { error: 'Endpoint не найден' });
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => sendJson(response, 500, { error: error.message }));
});

server.listen(port, () => console.log(`EduTask API запущен: http://localhost:${port}`));
