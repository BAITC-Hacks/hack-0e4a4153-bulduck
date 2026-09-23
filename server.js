const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath) && !process.env.OPENAI_API_KEY) {
  const match = fs.readFileSync(envPath, 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
  if (match) process.env.OPENAI_API_KEY = match[1].trim().replace(/^['"]|['"]$/g, '');
}
const key = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const clean = (value, max = 2000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const str = { type: 'string' };
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

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
    return JSON.parse(data.choices[0].message.content);
  } finally { clearTimeout(timer); }
}

function localQuestions(draft) {
  const questions = [];
  if (!/(цель|науч|осво|поня|смог|умел)/i.test(draft)) questions.push('Чему именно должны научиться участники?');
  if (!/(класс|курс|студент|ученик|преподавател)/i.test(draft)) questions.push('Для какого возраста или уровня подготовки это нужно?');
  if (!/(провер|оцен|тест|результат|критери)/i.test(draft)) questions.push('Как вы поймёте, что решение помогло?');
  if (!/(минут|недел|месяц|интернет|ограничен|бюджет)/i.test(draft)) questions.push('Есть ли ограничения по времени, доступу или материалам?');
  const selected = questions.slice(0, 3).length ? questions.slice(0, 3) : ['Какой результат будет самым полезным для вашей аудитории?'];
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

async function handleApi(route, body = {}) {
  if (route === '/api/improve') {
    const draft = clean(body.draft, 501);
    if (draft.length < 15 || draft.length > 500) throw { status: 400, message: 'Описание должно содержать от 15 до 500 символов.' };
    if (!key) return { improved: `${draft.replace(/[.!?\s]+$/, '')}. Уточните учебную цель, аудиторию и ожидаемый результат.`.slice(0, 500), demo: true };
    const result = await askAI('Улучши педагогическое описание на русском. Сохрани смысл, не выдумывай факты.', { draft }, obj({ improved: str }), 'improved_draft');
    return { improved: clean(result.improved, 500) };
  }
  if (route === '/api/questions') {
    const draft = clean(body.draft, 501);
    if (draft.length < 15 || draft.length > 500) throw { status: 400, message: 'Некорректное описание.' };
    if (!key) return { questions: localQuestions(draft), demo: true };
    const result = await askAI('Задай 2–3 коротких уточняющих вопроса к педагогической задаче на русском и предложи ответ на каждый. Ответы должны помогать сформулировать задачу. Если факт не указан, предложи вариант со словами «Можно...» или прямо укажи, что нужно уточнение. Не выдавай предположения за факты.', { draft }, obj({ questions: { type: 'array', items: obj({ question: str, answer: str }) } }), 'clarifying_answers');
    return { questions: result.questions.filter(x => typeof x?.question === 'string' && x.question.trim()).slice(0, 3).map(x => ({ question: clean(x.question, 200), answer: clean(x.answer, 500) })) };
  }
  if (route === '/api/generate') {
    const input = Object.fromEntries(['draft', 'audience', 'subject', 'format', 'deadline', 'materials', 'constraint'].map(k => [k, clean(body[k], 1000)]));
    input.answers = Array.isArray(body.answers) ? body.answers.slice(0, 3).map(x => ({ question: clean(x.question, 200), answer: clean(x.answer, 500) })) : [];
    if (!input.draft) throw { status: 400, message: 'Нужно описание задачи.' };
    if (!key) return { title: `${input.format || 'Проект'}: ${input.subject || 'образование'}`, context: `${input.draft}\nАудитория: ${input.audience || 'не указана'}. Материалы: ${input.materials || 'не указаны'}. ${input.answers.map(x => `${x.question} ${x.answer}`).join(' ')}`.trim(), result: `Готовый ${input.format.toLowerCase() || 'материал'} для ${input.audience.toLowerCase() || 'аудитории'}. Срок: ${input.deadline || 'не указан'}.`, criteria: `Решение соответствует заявленной учебной цели.\nУчтено ограничение: ${input.constraint || 'не указано'}.`, demo: true };
    return askAI('Составь ясную редактируемую карточку педагогической задачи на русском. Используй только данные пользователя, не выдумывай факты.', input, obj({ title: str, context: str, result: str, criteria: str }), 'task_card');
  }
  if (route === '/api/review') {
    const card = Object.fromEntries(['title', 'context', 'result', 'criteria'].map(k => [k, clean(body[k], 3000)]));
    if (!card.title) throw { status: 400, message: 'Нет карточки для проверки.' };
    if (!key) return { issues: localReview(card), demo: true };
    const result = await askAI('Проверь карточку педагогической задачи. Укажи до 4 конкретных пробелов или противоречий, которые мешают команде выполнить работу. Если всё достаточно ясно, верни пустой массив. Не выдумывай факты.', card, obj({ issues: { type: 'array', items: str } }), 'task_review');
    return { issues: result.issues.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) };
  }
  if (route === '/api/match') {
    const profile = { skills: clean(body.profile?.skills, 500), deadline: clean(body.profile?.deadline, 100) };
    const tasks = Array.isArray(body.tasks) ? body.tasks.slice(0, 50).map(x => Object.fromEntries(['id', 'title', 'context', 'result', 'subject', 'format', 'deadline'].map(k => [k, clean(x[k], 1000)]))) : [];
    if (profile.skills.length < 5 || !tasks.length) throw { status: 400, message: 'Укажите навыки команды и выберите задачи.' };
    if (!key) return { matches: localMatches(profile, tasks), demo: true };
    const result = await askAI('Сопоставь навыки команды с педагогическими задачами. Для каждой задачи верни id, оценку соответствия от 0 до 100 и одно короткое объяснение на русском. Не выдумывай навыки команды.', { profile, tasks }, obj({ matches: { type: 'array', items: obj({ id: str, score: { type: 'integer' }, reason: str }) } }), 'task_matches');
    return { matches: result.matches.filter(x => tasks.some(task => task.id === x.id)).map(x => ({ id: x.id, score: Math.max(0, Math.min(100, x.score)), reason: x.reason })).sort((a, b) => b.score - a.score) };
  }
  throw { status: 404, message: 'Маршрут не найден.' };
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100000) throw { status: 413, message: 'Слишком большой запрос.' };
      }
      const result = await handleApi(pathname, JSON.parse(raw || '{}'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(result));
    } catch (error) {
      const status = error.status || (error instanceof SyntaxError ? 400 : 502);
      if (status === 502) console.error(error);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: error.message || 'Не удалось выполнить запрос.' }));
    }
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'styles.css'].includes(file)) { res.writeHead(404); return res.end(); }
  fs.readFile(path.join(__dirname, file), (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] });
    res.end(data);
  });
});

if (require.main === module) server.listen(Number(process.env.PORT) || 3000, () => console.log(`EduTask: http://localhost:${server.address().port}`));
module.exports = { server, handleApi };
