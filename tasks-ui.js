// Shared-server UI. No localStorage writes: all publication and decision actions use the API.
const labels = {
  context: 'Контекст и потребность', materials: 'Материалы', expectedResult: 'Результат',
  successCriteria: 'Критерии успеха', constraints: 'Ограничения', users: 'Аудитория', contact: 'Контакт и взаимодействие'
};
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function field(label, value = '', multiline = false) {
  const wrapper = element('label', label, 'field-label');
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.value = value;
  input.maxLength = 5000;
  if (multiline) input.rows = 3;
  wrapper.append(input);
  return { wrapper, input };
}
const contactField = field('Контакт преподавателя (например, рабочая почта)');
const interactionField = field('Формат обратной связи (например, консультация раз в неделю)');
contactField.input.id = 'taskContact';
interactionField.input.id = 'taskInteraction';
$('#stepThree').append(contactField.wrapper, interactionField.wrapper);
const ratingPanel = element('div', '', 'ai-panel');
ratingPanel.setAttribute('role', 'status');
$('#stepThree').append(ratingPanel);
const confirmation = element('label', '', 'confirmation');
const checkbox = document.createElement('input');
checkbox.type = 'checkbox'; checkbox.id = 'confirmCard';
confirmation.append(checkbox, document.createTextNode(' Я проверил(а) и подтверждаю сведения карточки'));
$('#stepThree').append(confirmation);

function taskPayload() {
  const card = cardData(), details = formData();
  return { title: card.title, context: card.context, expectedResult: card.result,
    successCriteria: card.criteria.split('\n').filter(Boolean), users: [details.audience],
    subject: details.subject, format: details.format, deadline: details.deadline, materials: details.materials,
    constraints: details.constraint.split('\n').filter(Boolean), contact: contactField.input.value,
    interactionFormat: interactionField.input.value };
}
function ratingContent(score, container) {
  container.replaceChildren(element('strong', `Готовность: ${score.score} / 100`));
  const list = element('ul');
  for (const [key, item] of Object.entries(score.breakdown)) list.append(element('li', `${labels[key]}: ${item.points} / ${item.maxPoints}`));
  container.append(list);
  for (const missing of score.missingInformation) container.append(element('p', missing));
}
let ratingVersion = 0;
async function updateRating() {
  const version = ++ratingVersion;
  try {
    const score = await post('/api/tasks/score', taskPayload());
    if (version !== ratingVersion) return;
    ratingContent(score, ratingPanel);
    ratingPanel.append(element('small', 'Предварительная оценка. Баллы фиксируются после вашего подтверждения.'));
  } catch (error) { if (version === ratingVersion) ratingPanel.textContent = error.message; }
}
let ratingTimer;
for (const input of document.querySelectorAll('#createView input, #createView textarea, #createView select')) {
  if (input === checkbox) continue;
  input.addEventListener('input', () => {
    checkbox.checked = false;
    ++ratingVersion;
    clearTimeout(ratingTimer);
    ratingTimer = setTimeout(updateRating, 250);
  });
}

const role = field('Роль для демонстрации');
role.input.remove();
const roleSelect = document.createElement('select');
roleSelect.id = 'demoRole';
roleSelect.add(new Option('Преподаватель', 'teacher'));
roleSelect.add(new Option('Студенческая команда', 'team'));
role.wrapper.append(roleSelect);
$('.catalog-header').after(role.wrapper);
let activeTask;
const actions = element('section', '', 'task-actions');
taskDialog.append(actions);
roleSelect.addEventListener('change', () => { if (activeTask) renderTaskActions(activeTask); });

function renderTaskActions(task) {
  activeTask = task;
  actions.replaceChildren();
  const details = element('dl');
  for (const [label, value] of [['Аудитория', task.users.join(', ')], ['Предмет', task.subject], ['Материалы', task.materials], ['Ограничения', task.constraints.join(', ')], ['Срок', task.deadline], ['Контакт', task.contact], ['Обратная связь', task.interactionFormat]]) {
    details.append(element('dt', label), element('dd', value || 'Не указано'));
  }
  const score = element('div', '', 'ai-panel'); ratingContent(task, score);
  actions.append(details, score);
  const teacher = roleSelect.value === 'teacher';
  if (teacher) {
    const edit = element('button', 'Редактировать задачу', 'button secondary');
    edit.type = 'button';
    edit.addEventListener('click', () => renderEdit(task));
    actions.append(edit);
  } else {
    const form = document.createElement('form');
    form.append(element('h3', 'Предложить решение'));
    const inputs = {};
    for (const [key, label] of Object.entries({ teamName: 'Название команды', idea: 'Идея решения', plan: 'План работы', deadline: 'Срок', link: 'Ссылка на прототип' })) {
      const item = field(label, '', ['idea', 'plan'].includes(key));
      item.input.name = key; item.input.required = true;
      if (key === 'link') item.input.type = 'url';
      inputs[key] = item.input;
      form.append(item.wrapper);
    }
    const submit = element('button', 'Отправить предложение', 'button primary');
    form.append(submit);
    form.addEventListener('submit', async event => {
      event.preventDefault(); submit.disabled = true;
      try {
        await post(`/api/tasks/${task.id}/proposals`, Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value])));
        await openTask(task); await refreshCatalog(); showToast('Предложение сохранено');
      } catch (error) { showToast(error.message); }
      finally { submit.disabled = false; }
    });
    actions.append(form);
  }
  actions.append(element('h3', `Предложения команд: ${task.proposals.length}`));
  if (!task.proposals.length) actions.append(element('p', 'Предложений пока нет'));
  for (const proposal of task.proposals) {
    const item = element('article', '', 'ai-panel');
    item.append(element('strong', proposal.teamName), element('p', proposal.idea), element('p', 'План: ' + proposal.plan), element('p', 'Срок: ' + proposal.deadline));
    if (/^https?:\/\//i.test(proposal.link)) {
      const link = element('a', 'Открыть прототип'); link.href = proposal.link; link.target = '_blank'; link.rel = 'noopener noreferrer'; item.append(link);
    }
    item.append(element('p', ({ pending: 'Ожидает решения', accepted: 'Принято', rejected: 'Отклонено' })[proposal.status]));
    if (teacher) for (const [decision, label] of [['accepted', 'Принять'], ['rejected', 'Отклонить']]) {
      const button = element('button', label, 'button secondary');
      button.type = 'button'; button.disabled = proposal.status === decision;
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await request(`/api/tasks/${task.id}/proposals/${proposal.id}`, 'PATCH', { decision });
          await openTask(task); await refreshCatalog();
        } catch (error) { showToast(error.message); button.disabled = false; }
      });
      item.append(button);
    }
    actions.append(item);
  }
}

function renderEdit(task) {
  actions.replaceChildren(element('h3', 'Редактирование опубликованной задачи'));
  const form = document.createElement('form');
  const controls = {};
  const names = { title: 'Название', context: 'Контекст', users: 'Аудитория — по строкам', subject: 'Предмет', format: 'Формат', materials: 'Материалы', constraints: 'Ограничения — по строкам', expectedResult: 'Результат', successCriteria: 'Критерии — по строкам', deadline: 'Срок', contact: 'Контакт', interactionFormat: 'Обратная связь' };
  for (const [key, label] of Object.entries(names)) {
    const value = Array.isArray(task[key]) ? task[key].join('\n') : task[key];
    const item = field(label, value || '', true);
    item.input.required = ['title', 'context'].includes(key);
    controls[key] = item.input; form.append(item.wrapper);
  }
  const agree = element('label', '', 'confirmation');
  const check = document.createElement('input'); check.type = 'checkbox'; check.required = true;
  agree.append(check, document.createTextNode(' Подтверждаю изменения'));
  const save = element('button', 'Сохранить и пересчитать рейтинг', 'button primary');
  form.append(agree, save);
  form.addEventListener('submit', async event => {
    event.preventDefault(); save.disabled = true;
    const payload = Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, ['users', 'constraints', 'successCriteria'].includes(key) ? input.value.split('\n').filter(Boolean) : input.value]));
    try {
      await request(`/api/tasks/${task.id}`, 'PATCH', { ...payload, confirmed: true });
      await openTask(task); await refreshCatalog(); showToast('Изменения сохранены, рейтинг пересчитан');
    } catch (error) { showToast(error.message); }
    finally { save.disabled = false; }
  });
  actions.append(form);
}
const levelFilter = document.createElement('select');
levelFilter.setAttribute('aria-label', 'Уровень готовности');
for (const [label, value] of [['Все уровни', ''], ['Требует уточнения', 'draft'], ['Рабочая', 'working'], ['Готовая', 'ready'], ['Приоритетная', 'priority']]) levelFilter.add(new Option(label, value));
$('.catalog-toolbar').append(levelFilter);
levelFilter.addEventListener('change', renderCatalog);
const refresh = element('button', 'Обновить каталог', 'button secondary');
refresh.addEventListener('click', () => refreshCatalog().catch(error => showToast(error.message)));
$('.catalog-header').append(refresh);
refreshCatalog().catch(() => {
  catalog.replaceChildren(element('p', 'Не удалось загрузить каталог. Запустите сервер и откройте сайт через http://localhost:3000, затем нажмите «Обновить каталог».'));
});
