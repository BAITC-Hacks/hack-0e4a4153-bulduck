const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { calculateScore } = require('./scoring');

const textFields = ['title', 'context', 'subject', 'format', 'materials', 'expectedResult', 'deadline', 'contact', 'interactionFormat'];
const listFields = ['users', 'constraints', 'successCriteria'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
function fields(input) {
  if (!isObject(input)) fail(400, 'Ожидается объект карточки');
  const result = {};
  for (const key of textFields) {
    if (!(key in input)) continue;
    if (typeof input[key] !== 'string' || input[key].length > 10000) fail(400, `Некорректное поле ${key}`);
    result[key] = input[key].trim();
  }
  for (const key of listFields) {
    if (!(key in input)) continue;
    if (!Array.isArray(input[key]) || input[key].length > 50 || input[key].some(x => typeof x !== 'string' || x.length > 2000)) fail(400, `Некорректное поле ${key}`);
    result[key] = [...new Set(input[key].map(x => x.trim()).filter(Boolean))];
  }
  return result;
}
function decorate(task) {
  return { ...task, ...calculateScore(task), result: task.expectedResult, criteria: task.successCriteria.join('\n') };
}

// One process owns the JSON file. Write/rename is synchronous, so requests cannot interleave a read-modify-write.
function createTaskApi(ai, file = process.env.EDUTASK_DATA_FILE || path.join(__dirname, '..', 'data', 'runtime', 'tasks.json')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  function write(tasks) {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(tasks, null, 2), 'utf8');
    fs.renameSync(temporary, file);
  }
  if (!fs.existsSync(file)) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tasks.json'), 'utf8'));
    write(seed.map(task => ({ ...task, confirmed: true, interactionFormat: task.interactionFormat || '', proposals: task.proposals || [] })));
  }
  function read() {
    const tasks = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(tasks)) throw new Error('Invalid task storage');
    return tasks;
  }
  const find = (tasks, id) => tasks.find(task => task.id === id) || fail(404, 'Задача не найдена');

  return async function taskApi(method, url, body) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (method === 'POST' && url.pathname === '/api/tasks/score') {
      return { status: 200, data: calculateScore({ ...fields(body), confirmed: true }) };
    }
    if (method === 'GET' && url.pathname === '/api/tasks') {
      let tasks = read().filter(x => x.status !== 'draft').map(decorate);
      for (const key of ['subject', 'level']) if (url.searchParams.get(key)) tasks = tasks.filter(x => x[key] === url.searchParams.get(key));
      const query = (url.searchParams.get('q') || '').toLowerCase();
      tasks = tasks.filter(x => `${x.title} ${x.context}`.toLowerCase().includes(query));
      tasks.sort(url.searchParams.get('sort') === 'newest' ? (a,b) => (b.created || 0) - (a.created || 0) : (a,b) => b.score - a.score);
      return { status: 200, data: { tasks } };
    }
    if (method === 'POST' && url.pathname === '/api/tasks/draft') {
      if (typeof body.rawDescription !== 'string' || body.rawDescription.trim().length < 15 || body.rawDescription.length > 500) fail(400, 'Описание: от 15 до 500 символов');
      const rawDescription = body.rawDescription.trim();
      const response = await ai('/api/questions', { draft: rawDescription });
      const task = {
        ...Object.fromEntries(textFields.map(key => [key, ''])), ...Object.fromEntries(listFields.map(key => [key, []])),
        id: `task-${randomUUID()}`, rawDescription, context: rawDescription, status: 'draft',
        questions: response.questions, demo: Boolean(response.demo), confirmed: false, created: Date.now(), proposals: []
      };
      const tasks = read(); tasks.push(task); write(tasks);
      return { status: 201, data: decorate(task) };
    }
    if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'tasks') fail(404, 'Маршрут не найден');
    let tasks = read();
    let task = find(tasks, parts[2]);
    if (method === 'GET' && parts.length === 3) return { status: 200, data: decorate(task) };
    if (method === 'PATCH' && parts.length === 3) {
      const update = fields(body);
      if (!Object.keys(update).length) fail(400, 'Нет полей для обновления');
      if (task.status !== 'draft' && body.confirmed !== true) fail(400, 'Подтвердите изменения');
      if (task.status !== 'draft' && (!('title' in update ? update.title : task.title) || !('context' in update ? update.context : task.context))) fail(400, 'Нужны название и описание');
      Object.assign(task, update, { confirmed: body.confirmed === true });
      write(tasks);
      return { status: 200, data: decorate(task) };
    }
    if (method === 'POST' && parts.length === 4 && parts[3] === 'generate-card') {
      if (task.status !== 'draft') fail(409, 'Опубликованную карточку редактируют через PATCH');
      const answers = fields(body.answers || {});
      const original = JSON.stringify(task);
      const generated = await ai('/api/generate', {
        draft: task.rawDescription, audience: (answers.users || []).join(', '), subject: answers.subject,
        format: answers.format, materials: answers.materials, constraint: (answers.constraints || []).join('\n'),
        deadline: answers.deadline, answers: body.clarifications || []
      });
      tasks = read(); task = find(tasks, parts[2]);
      if (JSON.stringify(task) !== original) fail(409, 'Карточка изменена во время генерации. Повторите запрос');
      Object.assign(task, fields({ title: generated.title, context: generated.context, expectedResult: generated.result, successCriteria: generated.criteria.split('\n') }), answers, { confirmed: false, demo: Boolean(generated.demo) });
      write(tasks);
      return { status: 200, data: decorate(task) };
    }
    if (method === 'POST' && parts.length === 4 && parts[3] === 'publish') {
      if (body.confirmed !== true) fail(400, 'Подтвердите карточку перед публикацией');
      if (!task.title || !task.context) fail(422, 'Нужны название и описание задачи');
      // Repeated publication never resets proposals or selection.
      if (task.status === 'draft') Object.assign(task, { status: 'published', publishedAt: new Date().toISOString() });
      task.confirmed = true; write(tasks);
      return { status: 200, data: decorate(task) };
    }
    if (parts[3] === 'proposals' && task.status === 'draft') fail(409, 'Сначала опубликуйте задачу');
    if (method === 'GET' && parts.length === 4 && parts[3] === 'proposals') return { status: 200, data: { proposals: task.proposals } };
    if (method === 'POST' && parts.length === 4 && parts[3] === 'proposals') {
      const proposal = { id: `proposal-${randomUUID()}`, status: 'pending', createdAt: new Date().toISOString() };
      for (const key of ['teamName', 'idea', 'plan', 'deadline', 'link']) {
        if (typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 5000) fail(400, `Заполните ${key}`);
        proposal[key] = body[key].trim();
      }
      let link; try { link = new URL(proposal.link); } catch { fail(400, 'Некорректная ссылка'); }
      if (!['http:', 'https:'].includes(link.protocol)) fail(400, 'Ссылка должна начинаться с http:// или https://');
      task.proposals.push(proposal);
      task.status = task.proposals.some(x => x.status === 'accepted') ? 'selected' : 'in_review';
      write(tasks); return { status: 201, data: proposal };
    }
    if (method === 'PATCH' && parts.length === 5 && parts[3] === 'proposals') {
      if (!['accepted', 'rejected'].includes(body.decision)) fail(400, 'Решение: accepted или rejected');
      const proposal = task.proposals.find(x => x.id === parts[4]) || fail(404, 'Предложение не найдено');
      proposal.status = body.decision;
      task.status = task.proposals.some(x => x.status === 'accepted') ? 'selected' : task.proposals.some(x => x.status === 'pending') ? 'in_review' : 'published';
      write(tasks); return { status: 200, data: { task: decorate(task), proposal } };
    }
    fail(404, 'Маршрут не найден');
  };
}
module.exports = { createTaskApi };
