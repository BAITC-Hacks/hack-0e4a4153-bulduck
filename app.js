const state = { step: 1, questions: [], questionDraft: '', reviewSignature: '', matches: null, matchOnly: false };
const $ = selector => document.querySelector(selector);
const draftInput = $('#draftInput');
const nextButton = $('#nextButton');
const backButton = $('#backButton');
const toast = $('#toast');
const example = 'Мне нужен интерактивный урок истории Казахстана для 8 класса, чтобы ученики лучше поняли тему «Алаш Орда» и не просто заучивали даты.';
const catalog = $('.catalog-grid');
let published = [];
const allTasks = () => published;
async function refreshCatalog() {
  const response = await request('/api/tasks');
  published = response.tasks;
  renderCatalog();
}
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
  if (view === 'catalog') refreshCatalog().catch(error => showToast(error.message));
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
async function request(route, method = 'GET', data) {
  const response = await fetch(route, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Сервер недоступен');
  return result;
}
const post = (route, data) => request(route, 'POST', data);
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
  if (state.questionDraft === draft && state.taskId) return;
  questionPanel.querySelector('.panel-status').textContent = 'Подбираем уточнения…';
  const response = await post('/api/tasks/draft', { rawDescription: draft });
  state.taskId = response.id;
  state.questionDraft = draft;
  renderQuestions(response.questions);
  questionPanel.querySelector('.panel-status').textContent = response.demo ? 'Демо-подсказки: AI недоступен или отключён' : 'Ответьте на вопросы по задаче';
}
function formData() {
  return {
    draft: draftInput.value.trim(), audience: $('#audience').value, subject: $('#subject').value,
    format: $('#format').value, deadline: $('#deadline').value,
    materials: $('#materials').value.trim(), constraint: $('#constraint').value.trim(),
    answers: state.questions.filter(x => x.answer),
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
  $('#confirmCard').checked = false;
  const input = formData();
  const data = await post('/api/tasks/' + state.taskId + '/generate-card', {
    answers: { users: [input.audience], subject: input.subject, format: input.format,
      materials: input.materials, constraints: input.constraint.split('\n').filter(Boolean), deadline: input.deadline },
    clarifications: input.answers
  });
  setCard(data);
  showToast(data.demo ? 'Карточка создана в демо-режиме' : 'Карточка создана с помощью AI');
  await updateRating();
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
async function publish() {
  if (!$('#confirmCard').checked) { showToast('Подтвердите карточку перед публикацией'); return; }
  if (!cardData().title || !cardData().context) { showToast('Заполните название и описание'); return; }
  nextButton.disabled = true;
  try {
    await request('/api/tasks/' + state.taskId, 'PATCH', { ...taskPayload(), confirmed: true });
    await post('/api/tasks/' + state.taskId + '/publish', { confirmed: true });
    state.step = 1;
    state.taskId = null;
    state.questionDraft = '';
    state.reviewSignature = '';
    draftInput.value = '';
    $('#charCount').textContent = '0';
    $('#confirmCard').checked = false;
    updateStep();
    showToast('Задача сохранена на сервере и опубликована');
    setView('catalog');
  } catch (error) { showToast(error.message); }
  finally { nextButton.disabled = false; }
}

const matchPanel = document.createElement('div');
matchPanel.className = 'ai-panel match-panel';
matchPanel.innerHTML = '<div class="panel-heading"><div><strong>Подбор задач для команды</strong><p>Опишите навыки и интересы команды — покажем подходящие задачи.</p></div></div><div class="match-controls"><label class="field-label">Навыки и интересы команды<input id="teamSkills" maxlength="500" placeholder="Например: история, дизайн, интерактивные уроки"></label><label class="field-label">Доступный срок<select id="teamDeadline"><option>Гибкий срок</option><option>До 2 недель</option><option>До 1 месяца</option></select></label><button id="matchButton" class="button primary" type="button">Подобрать задачи</button></div><p id="matchStatus" class="panel-status" role="status"></p>';
$('.catalog-toolbar').before(matchPanel);
const searchInput = $('.search-box input');
const sortSelect = $('.catalog-toolbar select');
sortSelect.options[0].textContent = 'Сначала с высоким рейтингом';
sortSelect.add(new Option('Сначала подходящие', 'matches'));
const filterButton = $('.filter-button');
filterButton.innerHTML = 'Только подходящие';
function taskElement(task) {
  const card = document.createElement('article');
  card.className = 'task-card';
  const top = document.createElement('div');
  top.className = 'task-card-top';
  const status = document.createElement('span');
  status.className = `status-pill ${task.demo ? 'draft' : 'ready'}`;
  status.textContent = ({ draft: 'Требует уточнения', working: 'Рабочая', ready: 'Готовая', priority: 'Приоритетная' })[task.level];
  status.className = 'status-pill ' + (task.level === 'priority' ? 'ready' : task.level);
  top.append(status);
  const readiness = document.createElement('span');
  readiness.className = 'task-score';
  readiness.textContent = task.score + ' / 100';
  top.append(readiness);
  const match = state.matches?.find(x => x.id === task.id);
  if (match) {
    const score = document.createElement('span');
    score.className = 'task-score';
    score.textContent = `Подходит: ${match.score}%`;
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
  const level = document.querySelector('select[aria-label="Уровень готовности"]')?.value;
  if (level) tasks = tasks.filter(task => task.level === level);
  if (state.matchOnly) tasks = tasks.filter(task => (scores.get(task.id) || 0) >= 50);
  if (sortSelect.selectedIndex === 2 && state.matches) tasks.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));
  else if (sortSelect.selectedIndex === 1) tasks.sort((a, b) => (b.created || 0) - (a.created || 0));
  else tasks.sort((a, b) => b.score - a.score);
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
async function openTask(task) {
  try {
    const current = await request('/api/tasks/' + task.id);
    taskDialog.querySelector('h2').textContent = current.title;
    taskDialog.querySelector('.dialog-context').textContent = current.context;
    taskDialog.querySelector('.dialog-result').textContent = current.result || 'Не указано';
    taskDialog.querySelector('.dialog-criteria').textContent = current.criteria || 'Не указано';
    renderTaskActions(current);
    if (!taskDialog.open) taskDialog.showModal();
  } catch (error) { showToast(error.message); }
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
  sortSelect.selectedIndex = 2;
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
  nextButton.disabled = true;
  backButton.disabled = true;
  try {
    if (state.step === 1) {
      if (draftInput.value.trim().length < 15) throw new Error('Опишите задачу: минимум 15 символов');
      await getQuestions();
      state.step = 2;
      updateStep();
    } else if (state.step === 2) {
      nextButton.textContent = 'Создаём карточку…';
      await generateCard();
      state.step = 3;
      updateStep();
      await reviewCard();
    } else { await publish(); }
  } catch (error) { showToast(error.message); updateStep(); }
  finally { nextButton.disabled = false; backButton.disabled = false; }
});
backButton.addEventListener('click', () => { if (state.step > 1) { state.step--; updateStep(); } });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$('.hero-stats div:last-child').remove();
renderCatalog();
updateStep();
