const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const port = Number(process.env.PORT || 3000);
const dataPath = path.join(__dirname, '..', 'data', 'tasks.json');

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

async function handle(request, response) {
  if (request.method === 'OPTIONS') return sendJson(response, 204, {});

  const url = new URL(request.url, `http://${request.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { status: 'ok', service: 'edutask-api' });
  }

  if (request.method === 'GET' && url.pathname === '/api/tasks') {
    let tasks = readTasks().filter((task) => task.status === 'published');
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
    return sendJson(response, 201, createQuestions(body.rawDescription.trim()));
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
