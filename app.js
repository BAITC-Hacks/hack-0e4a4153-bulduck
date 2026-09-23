const state = { step: 1, questions: [], questionDraft: '', reviewSignature: '', matches: null, matchOnly: false };
const $ = selector => document.querySelector(selector);
const draftInput = $('#draftInput');
const nextButton = $('#nextButton');
const backButton = $('#backButton');
const toast = $('#toast');
const example = 'Мне нужен интерактивный урок истории Казахстана для 8 класса, чтобы ученики лучше поняли тему «Алаш Орда» и не просто заучивали даты.';
const storeKey = 'edutask.tasks.v1';
const catalog = $('.catalog-grid');
const demoTasks = [...catalog.querySelectorAll('.task-card')].map((card, index) => ({
  id: `demo-${index + 1}`, title: card.querySelector('h3').textContent,
  context: card.querySelector('p').textContent, result: '',
  criteria: '', subject: [...card.querySelectorAll('.task-tags span')].map(x => x.textContent).join(', '),
  format: '', deadline: 'Гибкий срок', demo: true, created: index,
}));
function loadTasks() {
  try {
    const items = JSON.parse(localStorage.getItem(storeKey) || '[]');
    return Array.isArray(items) ? items.filter(x => x && typeof x.id === 'string' && typeof x.title === 'string') : [];
  } catch { return []; }
}
let published = loadTasks();
const allTasks = () => [...published, ...demoTasks];
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}
function setView(view) {
  $('#createView').classList.toggle('hidden', view !== 'create');
  $('#catalogView').classList.toggle('hidden', view !== 'catalog');
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'catalog') renderCatalog();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function updateStep() {
  document.querySelectorAll('.step-content').forEach((section, index) => section.classList.toggle('active-step', index + 1 === state.step));
  $('#progressBar').style.width = `${state.step * 33.333}%`;
  $('#stepLabel').textContent = `Шаг ${state.step} из 3`;
  $('#stepNumber').textContent = String(state.step).padStart(2, '0');
  backButton.classList.toggle('hidden', state.step === 1);
  nextButton.innerHTML = state.step === 3 ? 'Опубликовать задачу <span>↗</span>' : 'Продолжить <span>→</span>';
  $('#stepTitle').textContent = ['','Опишите педагогическую задачу','Уточним детали','Проверьте карточку задачи'][state.step];
  document.querySelectorAll('.timeline-item').forEach((item, index) => item.classList.toggle('current', index + 1 === state.step));
}
async function post(route, data) {
  const response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!response.ok) throw new Error('Сервер недоступен');
  return response.json();
}
function fallbackQuestions(draft) {
  const questions = [];
  if (!/(цель|науч|осво|понял|смог|умел)/i.test(draft)) questions.push('Чему именно должны научиться участники?');
  if (!/(класс|курс|студент|ученик|преподавател)/i.test(draft)) questions.push('Для какого возраста или уровня подготовки это нужно?');
  if (!/(провер|оцен|тест|результат|критери)/i.test(draft)) questions.push('Как вы поймёте, что решение помогло?');
  if (!/(минут|недел|месяц|интернет|ограничен|бюджет)/i.test(draft)) questions.push('Есть ли ограничения по времени или доступу?');
  return questions.slice(0, 3).length ? questions.slice(0, 3) : ['Какой результат будет самым полезным для вашей аудитории?'];
}
const questionPanel = document.createElement('div');
questionPanel.className = 'ai-panel';
questionPanel.innerHTML = '<strong>Вопросы по вашему описанию</strong><p class="panel-status" role="status"></p><div class="question-fields"></div>';
$('#stepTwo .question-intro').after(questionPanel);
function renderQuestions(questions) {
  const fields = questionPanel.querySelector('.question-fields');
  fields.replaceChildren();
  state.questions = questions.map(question => ({ question, answer: '' }));
  for (const item of state.questions) {
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = item.question;
    const input = document.createElement('textarea');
    input.rows = 2;
    input.maxLength = 500;
    input.placeholder = 'Ваш ответ (можно пропустить)';
    input.addEventListener('input', () => { item.answer = input.value.trim(); });
    label.append(input);
    fields.append(label);
  }
}
async function getQuestions() {
  const draft = draftInput.value.trim();
  if (state.questionDraft === draft && state.questions.length) return;
  state.questionDraft = draft;
  questionPanel.querySelector('.panel-status').textContent = 'Подбираем уточнения…';
  try {
    const response = await post('/api/questions', { draft });
    renderQuestions(Array.isArray(response.questions) && response.questions.length ? response.questions : fallbackQuestions(draft));
    questionPanel.querySelector('.panel-status').textContent = response.demo ? 'Демо-подсказки по вашему описанию' : 'Ответьте на важные для задачи вопросы';
  } catch {
    renderQuestions(fallbackQuestions(draft));
    questionPanel.querySelector('.panel-status').textContent = 'Подсказки по вашему описанию';
  }
}
function formData() {
  return {
    draft: draftInput.value.trim(), audience: $('#audience').value, subject: $('#subject').value,
    format: $('#format').value, deadline: $('#deadline').value,
    materials: $('#materials').value.trim(), constraint: $('#constraint').value.trim(),
    answers: state.questions.filter(x => x.answer),
  };
}
function fallbackCard(input) {
  return {
    title: `${input.format} по предмету «${input.subject}»`,
    context: `${input.draft}\nАудитория: ${input.audience}. Материалы: ${input.materials || 'не указаны'}.\n${input.answers.map(x => `${x.question} ${x.answer}`).join('\n')}`.trim(),
    result: `Готовый ${input.format.toLowerCase()} для ${input.audience.toLowerCase()}. Срок: ${input.deadline}.`,
    criteria: `Решение соответствует учебной цели.\nУчтено ограничение: ${input.constraint || 'не указано'}.`,
  };
}
function cardData() {
  return { title: $('#taskTitle').value.trim(), context: $('#taskContext').value.trim(), result: $('#taskResult').value.trim(), criteria: $('#taskCriteria').value.trim() };
}
function setCard(data) {
  for (const [field, selector] of Object.entries({ title: '#taskTitle', context: '#taskContext', result: '#taskResult', criteria: '#taskCriteria' })) {
    $(selector).value = typeof data[field] === 'string' ? data[field] : '';
  }
}
async function generateCard() {
  const input = formData();
  try {
    const data = await post('/api/generate', input);
    setCard(data);
    showToast(data.demo ? 'Карточка создана в демо-режиме' : 'Карточка создана с помощью AI');
  } catch {
    setCard(fallbackCard(input));
    showToast('Карточка создана локально');
  }
}
const reviewPanel = document.createElement('div');
reviewPanel.className = 'ai-panel review-panel';
reviewPanel.innerHTML = '<div class="panel-heading"><strong>Проверка перед публикацией</strong><button id="reviewButton" class="button secondary" type="button">Проверить ещё раз</button></div><div class="review-result" role="status">Проверяем карточку…</div>';
$('#stepThree .generated-banner').after(reviewPanel);
function fallbackReview(card) {
  const issues = [];
  if (card.title.length < 12) issues.push('Уточните название задачи.');
  if (card.context.length < 45) issues.push('Добавьте в контекст проблему и аудиторию.');
  if (card.result.length < 35) issues.push('Опишите конкретный результат работы команды.');
  if (card.criteria.length < 30 || !/(\d|провер|тест|задан|оцен|доступ|работа|минут)/i.test(card.criteria)) issues.push('Добавьте проверяемый критерий успеха.');
  return issues;
}
async function reviewCard() {
  const card = cardData();
  const signature = JSON.stringify(card);
  const resultBox = reviewPanel.querySelector('.review-result');
  resultBox.textContent = 'Проверяем карточку…';
  $('#reviewButton').disabled = true;
  nextButton.disabled = true;
  let issues;
  try {
    const response = await post('/api/review', card);
    issues = Array.isArray(response.issues) ? response.issues : fallbackReview(card);
  } catch { issues = fallbackReview(card); }
  resultBox.replaceChildren();
  if (issues.length) {
    const list = document.createElement('ul');
    for (const issue of issues) {
      const li = document.createElement('li');
      li.textContent = issue;
      list.append(li);
    }
    resultBox.append(list);
  } else resultBox.textContent = 'Существенных пробелов не найдено. Проверьте текст сами перед публикацией.';
  state.reviewSignature = signature;
  $('#reviewButton').disabled = false;
  nextButton.disabled = false;
}
$('#reviewButton').addEventListener('click', reviewCard);
for (const selector of ['#taskTitle', '#taskContext', '#taskResult', '#taskCriteria']) {
  $(selector).addEventListener('input', () => {
    state.reviewSignature = '';
    reviewPanel.querySelector('.review-result').textContent = 'Карточка изменена. Проверьте её ещё раз перед публикацией.';
  });
}
function publish() {
  const card = cardData();
  if (!card.title || !card.context || !card.result || !card.criteria) {
    showToast('Заполните все поля карточки');
    return;
  }
  if (state.reviewSignature !== JSON.stringify(card)) {
    reviewCard();
    showToast('Сначала проверьте обновлённую карточку');
    return;
  }
  const details = formData();
  const task = { ...card, id: globalThis.crypto?.randomUUID?.() || `task-${Date.now()}`, subject: details.subject, format: details.format, deadline: details.deadline, created: Date.now() };
  published.unshift(task);
  try { localStorage.setItem(storeKey, JSON.stringify(published)); }
  catch { showToast('Не удалось сохранить задачу в браузере'); published.shift(); return; }
  state.step = 1;
  state.questionDraft = '';
  state.reviewSignature = '';
  draftInput.value = '';
  $('#charCount').textContent = '0';
  updateStep();
  showToast('Задача опубликована в каталоге');
  setView('catalog');
}

const matchPanel = document.createElement('div');
matchPanel.className = 'ai-panel match-panel';
matchPanel.innerHTML = '<div class="panel-heading"><div><strong>Подбор задач для команды</strong><p>Опишите навыки и интересы команды — покажем подходящие задачи.</p></div></div><div class="match-controls"><label class="field-label">Навыки и интересы команды<input id="teamSkills" maxlength="500" placeholder="Например: история, дизайн, интерактивные уроки"></label><label class="field-label">Доступный срок<select id="teamDeadline"><option>Гибкий срок</option><option>До 2 недель</option><option>До 1 месяца</option></select></label><button id="matchButton" class="button primary" type="button">Подобрать задачи</button></div><p id="matchStatus" class="panel-status" role="status"></p>';
$('.catalog-toolbar').before(matchPanel);
const searchInput = $('.search-box input');
const sortSelect = $('.catalog-toolbar select');
sortSelect.options[0].textContent = 'Сначала подходящие';
const filterButton = $('.filter-button');
filterButton.innerHTML = 'Только подходящие';
function taskElement(task) {
  const card = document.createElement('article');
  card.className = 'task-card';
  const top = document.createElement('div');
  top.className = 'task-card-top';
  const status = document.createElement('span');
  status.className = `status-pill ${task.demo ? 'draft' : 'ready'}`;
  status.textContent = task.demo ? 'Пример' : 'Опубликована';
  top.append(status);
  const match = state.matches?.find(x => x.id === task.id);
  if (match) {
    const score = document.createElement('span');
    score.className = 'task-score';
    score.textContent = `${match.score}%`;
    score.title = 'Совпадение с навыками команды';
    top.append(score);
  }
  const title = document.createElement('h3');
  title.textContent = task.title;
  const description = document.createElement('p');
  description.textContent = task.context;
  const tags = document.createElement('div');
  tags.className = 'task-tags';
  for (const text of [task.subject, task.deadline].filter(Boolean)) {
    const tag = document.createElement('span');
    tag.textContent = text;
    tags.append(tag);
  }
  const bottom = document.createElement('div');
  bottom.className = 'task-card-bottom';
  const note = document.createElement('span');
  note.textContent = match ? match.reason : task.demo ? 'Пример задачи' : 'Новая задача';
  const button = document.createElement('button');
  button.className = 'text-button';
  button.type = 'button';
  button.textContent = 'Открыть →';
  button.addEventListener('click', () => openTask(task));
  bottom.append(note, button);
  card.append(top, title, description, tags, bottom);
  return card;
}
function renderCatalog() {
  const query = searchInput.value.trim().toLowerCase();
  const scores = new Map((state.matches || []).map(x => [x.id, x.score]));
  let tasks = allTasks().filter(task => `${task.title} ${task.context} ${task.subject}`.toLowerCase().includes(query));
  if (state.matchOnly) tasks = tasks.filter(task => (scores.get(task.id) || 0) >= 50);
  if (sortSelect.selectedIndex === 0 && state.matches) tasks.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));
  else tasks.sort((a, b) => b.created - a.created);
  catalog.replaceChildren(...tasks.map(taskElement));
  if (!tasks.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = state.matchOnly ? 'Подходящих задач пока нет. Попробуйте другой профиль команды.' : 'Задачи не найдены.';
    catalog.append(empty);
  }
  $('.nav-count').textContent = allTasks().length;
  $('.hero-stats strong').textContent = allTasks().length;
}
const taskDialog = document.createElement('dialog');
taskDialog.className = 'task-dialog';
taskDialog.innerHTML = '<button class="dialog-close" type="button" aria-label="Закрыть">×</button><h2></h2><p class="dialog-context"></p><h3>Ожидаемый результат</h3><p class="dialog-result"></p><h3>Критерии успеха</h3><p class="dialog-criteria"></p>';
document.body.append(taskDialog);
taskDialog.querySelector('.dialog-close').addEventListener('click', () => taskDialog.close());
taskDialog.addEventListener('click', event => { if (event.target === taskDialog) taskDialog.close(); });
function openTask(task) {
  taskDialog.querySelector('h2').textContent = task.title;
  taskDialog.querySelector('.dialog-context').textContent = task.context;
  taskDialog.querySelector('.dialog-result').textContent = task.result || 'В примере не указано.';
  taskDialog.querySelector('.dialog-criteria').textContent = task.criteria || 'В примере не указаны.';
  taskDialog.showModal();
}
$('#matchButton').addEventListener('click', async () => {
  const skills = $('#teamSkills').value.trim();
  if (skills.length < 5) { showToast('Напишите навыки или интересы команды'); $('#teamSkills').focus(); return; }
  const button = $('#matchButton');
  button.disabled = true;
  $('#matchStatus').textContent = 'Подбираем задачи…';
  const profile = { skills, deadline: $('#teamDeadline').value };
  const tasks = allTasks();
  try {
    const result = await post('/api/match', { profile, tasks });
    state.matches = result.matches;
    $('#matchStatus').textContent = result.demo ? 'Показано совпадение по словам в демо-режиме.' : 'Задачи отсортированы по соответствию команде.';
  } catch {
    state.matches = tasks.map(task => {
      const skillsWords = skills.toLowerCase().match(/[а-яёa-z]{4,}/g) || [];
      const found = skillsWords.filter(word => `${task.title} ${task.context} ${task.subject}`.toLowerCase().includes(word.slice(0, 5)));
      return { id: task.id, score: Math.min(95, 25 + found.length * 18), reason: found.length ? `Совпадает тема: ${found.slice(0, 3).join(', ')}.` : 'Явного совпадения по навыкам нет.' };
    });
    $('#matchStatus').textContent = 'Показано локальное совпадение по словам.';
  } finally {
    button.disabled = false;
    sortSelect.selectedIndex = 0;
    renderCatalog();
  }
});
searchInput.addEventListener('input', renderCatalog);
sortSelect.addEventListener('change', renderCatalog);
filterButton.addEventListener('click', () => {
  if (!state.matches) { showToast('Сначала укажите навыки команды'); return; }
  state.matchOnly = !state.matchOnly;
  filterButton.classList.toggle('active', state.matchOnly);
  renderCatalog();
});
draftInput.addEventListener('input', () => { $('#charCount').textContent = draftInput.value.length; });
$('#fillExample').addEventListener('click', () => { draftInput.value = example; $('#charCount').textContent = example.length; draftInput.focus(); });
$('#improveDraft').addEventListener('click', async () => {
  const draft = draftInput.value.trim();
  if (draft.length < 15) { showToast('Сначала опишите задачу — хотя бы несколько слов'); draftInput.focus(); return; }
  const button = $('#improveDraft');
  button.disabled = true;
  try {
    const result = await post('/api/improve', { draft });
    draftInput.value = result.improved;
    showToast(result.demo ? 'Добавлена демо-подсказка' : 'Описание улучшено с помощью AI');
  } catch {
    draftInput.value = `${draft.slice(0, 420).replace(/[.!?\s]+$/, '')}. Уточните учебную цель и ожидаемый результат.`.slice(0, 500);
    showToast('Добавлена подсказка к описанию');
  } finally { button.disabled = false; $('#charCount').textContent = draftInput.value.length; }
});
nextButton.addEventListener('click', async () => {
  if (state.step === 1) {
    if (draftInput.value.trim().length < 15) { showToast('Добавьте хотя бы несколько слов о задаче'); draftInput.focus(); return; }
    state.step = 2;
    updateStep();
    nextButton.disabled = true;
    await getQuestions();
    nextButton.disabled = false;
    return;
  }
  if (state.step === 2) {
    nextButton.disabled = true;
    nextButton.textContent = 'Создаём карточку…';
    await generateCard();
    state.step = 3;
    updateStep();
    await reviewCard();
    return;
  }
  publish();
});
backButton.addEventListener('click', () => { if (state.step > 1) { state.step--; updateStep(); } });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('.hero-stats div:last-child').remove();
renderCatalog();
updateStep();
