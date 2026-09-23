const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createTaskApi } = require('./api/tasks');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
const key = process.env.AI_MODE === 'demo' ? '' : process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const str = { type: 'string' };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

function validateOutput(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI object');
    if (Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) throw new Error('Unexpected AI field');
    for (const [key, rule] of Object.entries(schema.properties)) validateOutput(value[key], rule);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error('Invalid AI array');
    value.forEach(item => validateOutput(item, schema.items));
  } else if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) throw new Error('Invalid AI field');
}

async function askAI(instruction, input, schema, name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: instruction + ' Верни JSON.' },
        { role: 'user', content: JSON.stringify(input) },
      ], response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } } }),
    });
    if (!response.ok) throw new Error(`AI status ${response.status}`);
    const data = await response.json();
    if (data.choices?.[0]?.finish_reason !== 'stop' || data.choices?.[0]?.message?.refusal) throw new Error('AI response incomplete');
    const result = JSON.parse(data.choices[0].message.content);
    validateOutput(result, schema);
    return result;
  } finally { clearTimeout(timer); }
}

function localQuestions(draft) {
  const questions = [];
  if (!/(цель|науч|осво|поня|смог|умел)/i.test(draft)) questions.push('Чему именно должны научиться участники?');
  if (!/(класс|курс|студент|ученик|преподавател)/i.test(draft)) questions.push('Для какого возраста или уровня подготовки это нужно?');
  if (!/(провер|оцен|тест|результат|критери)/i.test(draft)) questions.push('Как вы поймёте, что решение помогло?');
  if (!/(минут|недел|месяц|интернет|ограничен|бюджет)/i.test(draft)) questions.push('Есть ли ограничения по времени, доступу или материалам?');
  const selected = [...new Set([...questions, 'Какие материалы вы предоставите команде?', 'Как будет проходить обратная связь с командой?', 'Какой результат команда должна передать?'])].slice(0, 3);
  return selected.map(question => ({
    question,
    answer: question.startsWith('Чему')
      ? 'Можно сформулировать цель как умение объяснить тему своими словами и применить знания в задании.'
      : question.startsWith('Для какого')
        ? 'Уровень подготовки стоит уточнить у преподавателя.'
        : question.startsWith('Как вы поймёте')
          ? 'Можно проверить понимание коротким заданием или мини-тестом после занятия.'
          : question.startsWith('Есть ли')
            ? 'Ограничения по времени, доступу и материалам стоит уточнить у преподавателя.'
            : 'Полезным результатом может стать готовый материал с заданиями и способом проверки понимания.',
  }));
}

function localReview(card) {
  const issues = [];
  if (card.title.length < 12) issues.push('Уточните название: что именно нужно создать и для кого?');
  if (card.context.length < 45) issues.push('Добавьте в контекст проблему и целевую аудиторию.');
  if (card.result.length < 35) issues.push('Опишите конкретный результат, который команда должна передать.');
  if (card.criteria.length < 30 || !/(\d|провер|тест|задан|оцен|доступ|работа|минут)/i.test(card.criteria)) issues.push('Добавьте проверяемый критерий успеха, например число заданий или способ проверки знаний.');
  return issues;
}

const words = value => [...new Set(clean(value, 4000).toLowerCase().match(/[а-яёa-z0-9]{4,}/g) || [])].filter(x => !/^(для|этот|нужно|задач|создать|проект|ученик|команд|урок|материал|готовый|результат|формат)$/.test(x));
function localMatches(profile, tasks) {
  const skills = words(profile.skills);
  return tasks.map(task => {
    const taskWords = words(`${task.title} ${task.context} ${task.result} ${task.subject} ${task.format}`);
    const shared = skills.filter(word => taskWords.some(other => other.startsWith(word.slice(0, 5)) || word.startsWith(other.slice(0, 5))));
    const score = Math.min(95, 25 + shared.length * 18 + (profile.deadline === 'Гибкий срок' || profile.deadline === task.deadline ? 12 : 0));
    return { id: task.id, score, reason: shared.length ? `Совпадают навыки и тема: ${shared.slice(0, 3).join(', ')}.` : 'Явного совпадения по навыкам нет; изучите задачу вручную.' };
  }).sort((a, b) => b.score - a.score);
}

async function handleApi(route, body = {}, demoOnly = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw { status: 400, message: 'Ожидается JSON-объект' };
  const useAI = Boolean(key) && !demoOnly;
  if (route === '/api/improve') {
    const draft = clean(body.draft, 501);
    if (draft.length < 15 || draft.length > 500) throw { status: 400, message: 'Описание должно содержать от 15 до 500 символов.' };
    if (!useAI) return { improved: `${draft.replace(/[.!?\s]+$/, '')}. Уточните учебную цель, аудиторию и ожидаемый результат.`.slice(0, 500), demo: true };
    const result = await askAI('Улучши педагогическое описание на русском. Сохрани смысл, не выдумывай факты.', { draft }, obj({ improved: str }), 'improved_draft');
    return { improved: clean(result.improved, 500) };
  }
  if (route === '/api/questions') {
    const draft = clean(body.draft, 501);
    if (draft.length < 15 || draft.length > 500) throw { status: 400, message: 'Некорректное описание.' };
    if (!useAI) return { questions: localQuestions(draft), demo: true };
    const result = await askAI('Задай ровно 3 коротких уточняющих вопроса к педагогической задаче на русском и предложи ответ на каждый. Ответы должны помогать сформулировать задачу. Если факт не указан, предложи вариант со словами «Можно...» или прямо укажи, что нужно уточнение. Не выдавай предположения за факты.', { draft }, obj({ questions: { type: 'array', items: obj({ question: str, answer: str }) } }), 'clarifying_answers');
    const suggestions = result.questions.filter(x => typeof x?.question === 'string' && x.question.trim()).map(x => ({ question: clean(x.question, 200), answer: clean(x.answer, 500) }));
    const unique = new Map([...suggestions, ...localQuestions(draft)].map(x => [x.question, x]));
    return { questions: [...unique.values()].slice(0, 3) };
  }
  if (route === '/api/generate') {
    const input = Object.fromEntries(['draft', 'audience', 'subject', 'format', 'deadline', 'materials', 'constraint'].map(k => [k, clean(body[k], 1000)]));
    input.answers = Array.isArray(body.answers) ? body.answers.filter(x => x && typeof x === 'object').slice(0, 3).map(x => ({ question: clean(x.question, 200), answer: clean(x.answer, 500) })) : [];
    if (!input.draft) throw { status: 400, message: 'Нужно описание задачи.' };
    if (!useAI) return { title: `${input.format || 'Проект'}: ${input.subject || 'образование'}`, context: [input.draft, ...input.answers.map(x => `${x.question} ${x.answer}`)].join('\n'), result: '', criteria: '', demo: true };
    return askAI('Составь ясную редактируемую карточку педагогической задачи на русском. Используй только данные пользователя, не выдумывай факты.', input, obj({ title: str, context: str, result: str, criteria: str }), 'task_card');
  }
  if (route === '/api/review') {
    const card = Object.fromEntries(['title', 'context', 'result', 'criteria'].map(k => [k, clean(body[k], 3000)]));
    if (!card.title) throw { status: 400, message: 'Нет карточки для проверки.' };
    if (!useAI) return { issues: localReview(card), demo: true };
    const result = await askAI('Проверь карточку педагогической задачи. Укажи до 4 конкретных пробелов или противоречий, которые мешают команде выполнить работу. Если всё достаточно ясно, верни пустой массив. Не выдумывай факты.', card, obj({ issues: { type: 'array', items: str } }), 'task_review');
    return { issues: result.issues.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) };
  }
  if (route === '/api/match') {
    const profile = { skills: clean(body.profile?.skills, 500), deadline: clean(body.profile?.deadline, 100) };
    const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 50).map(x => Object.fromEntries(['id', 'title', 'context', 'result', 'subject', 'format', 'deadline'].map(k => [k, clean(x[k], 1000)]))) : [];
    if (profile.skills.length < 5 || !tasks.length) throw { status: 400, message: 'Укажите навыки команды и выберите задачи.' };
    if (!useAI) return { matches: localMatches(profile, tasks), demo: true };
    const result = await askAI('Сопоставь навыки команды с педагогическими задачами. Для каждой задачи верни id, оценку соответствия от 0 до 100 и одно короткое объяснение на русском. Не выдумывай навыки команды.', { profile, tasks }, obj({ matches: { type: 'array', items: obj({ id: str, score: { type: 'integer' }, reason: str }) } }), 'task_matches');
    return { matches: result.matches.filter(x => tasks.some(task => task.id === x.id)).map(x => ({ id: x.id, score: Math.max(0, Math.min(100, x.score)), reason: x.reason })).sort((a, b) => b.score - a.score) };
  }
  throw { status: 404, message: 'Маршрут не найден.' };
}

async function safeAI(route, body) {
  try { return await handleApi(route, body); }
  catch (error) {
    if (error.status) throw error;
    const fallback = await handleApi(route, body, true);
    return { ...fallback, demo: true, warning: 'AI временно недоступен. Использован демо-режим.' };
  }
}
const taskApi = createTaskApi(safeAI);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ status: 'ok', service: 'edutask-api', ai: Boolean(key), model }));
  }
  if (pathname.startsWith('/api/')) {
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 100000) throw { status: 413, message: 'Слишком большой запрос.' };
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw { status: 400, message: 'Ожидается JSON-объект' };
      let result;
      if (pathname === '/api/tasks' || pathname.startsWith('/api/tasks/')) {
        result = await taskApi(req.method, new URL(req.url, 'http://localhost'), body);
      } else {
        if (req.method !== 'POST') throw { status: 404, message: 'Маршрут не найден' };
        result = { status: 200, data: await safeAI(pathname, body) };
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(result.data));
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 500);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: status === 500 ? 'Не удалось сохранить или прочитать данные сервера.' : error.message || 'Не удалось выполнить запрос.' }));
    }
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'tasks-ui.js', 'ui-preferences.js', 'styles.css', 'favicon.svg'].includes(file)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(__dirname, file), (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] });
    res.end(data);
  });
});

if (require.main === module) server.listen(Number(process.env.PORT) || 3000, () => console.log(`EduTask: http://localhost:${server.address().port}`));
module.exports = { server, handleApi, safeAI };
