const state = { step: 1 };
const draftInput = document.querySelector('#draftInput');
const charCount = document.querySelector('#charCount');
const nextButton = document.querySelector('#nextButton');
const backButton = document.querySelector('#backButton');
const progressBar = document.querySelector('#progressBar');
const stepLabel = document.querySelector('#stepLabel');
const stepNumber = document.querySelector('#stepNumber');
const stepTitle = document.querySelector('#stepTitle');
const toast = document.querySelector('#toast');
const example = 'Мне нужен интерактивный урок истории Казахстана для 8 класса, чтобы ученики лучше поняли тему «Алаш Орда» и не просто заучивали даты.';

function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 3000); }
function setView(view) { document.querySelector('#createView').classList.toggle('hidden', view !== 'create'); document.querySelector('#catalogView').classList.toggle('hidden', view !== 'catalog'); document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view)); if (view === 'catalog') window.scrollTo({ top: 0, behavior: 'smooth' }); }
function updateStep() { document.querySelectorAll('.step-content').forEach((section, index) => section.classList.toggle('active-step', index + 1 === state.step)); progressBar.style.width = `${state.step * 33.333}%`; stepLabel.textContent = `Шаг ${state.step} из 3`; stepNumber.textContent = String(state.step).padStart(2, '0'); backButton.classList.toggle('hidden', state.step === 1); nextButton.innerHTML = state.step === 3 ? 'Опубликовать задачу <span>↗</span>' : 'Продолжить <span>→</span>'; stepTitle.textContent = state.step === 1 ? 'Опишите педагогическую задачу' : state.step === 2 ? 'Уточним детали' : 'Проверьте карточку задачи'; document.querySelectorAll('.timeline-item').forEach((item, index) => item.classList.toggle('current', index + 1 === state.step)); }
function generateCard() { const audience = document.querySelector('#audience').value; const subject = document.querySelector('#subject').value; const format = document.querySelector('#format').value; const deadline = document.querySelector('#deadline').value; const materials = document.querySelector('#materials').value; const constraint = document.querySelector('#constraint').value; const draft = draftInput.value.trim() || example; document.querySelector('#taskTitle').value = `${format} по предмету «${subject}»`; document.querySelector('#taskContext').value = `${draft}\n\nЦелевая аудитория: ${audience}. Уже есть: ${materials}.`; document.querySelector('#taskResult').value = `Готовый ${format.toLowerCase()} для ${audience.toLowerCase()} со структурой занятия, заданиями и способом проверить понимание темы. Срок: ${deadline}.`; document.querySelector('#taskCriteria').value = `Понятная структура урока\nМинимум 3 практических задания\nУчтено ограничение: ${constraint}`; }
draftInput.addEventListener('input', () => { charCount.textContent = draftInput.value.length; });
document.querySelector('#fillExample').addEventListener('click', () => { draftInput.value = example; charCount.textContent = example.length; draftInput.focus(); });
nextButton.addEventListener('click', () => { if (state.step === 1 && draftInput.value.trim().length < 15) { showToast('Добавьте хотя бы несколько слов о задаче'); draftInput.focus(); return; } if (state.step < 3) { if (state.step === 2) generateCard(); state.step += 1; updateStep(); return; } showToast('Задача опубликована в каталоге'); setTimeout(() => setView('catalog'), 700); });
backButton.addEventListener('click', () => { if (state.step > 1) { state.step -= 1; updateStep(); } });
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('.task-card .text-button').forEach((button) => button.addEventListener('click', () => showToast('Детали задачи откроются в следующей версии')));

const catalogSearch = document.querySelector('.search-box input');
const catalogSort = document.querySelector('.catalog-toolbar select');
const catalogGrid = document.querySelector('.catalog-grid');
const catalogCards = [...document.querySelectorAll('.task-card')];
const filterButton = document.querySelector('.filter-button');
const catalogEmpty = document.createElement('p');
catalogEmpty.hidden = true;
catalogEmpty.textContent = 'По вашему запросу задач не найдено. Попробуйте изменить поиск или фильтр.';
catalogEmpty.style.cssText = 'padding:32px;text-align:center;color:#7b8981;background:#fff;border:1px solid #dfe6e1;border-radius:12px';
catalogGrid.after(catalogEmpty);
const filterModes = [
  { label: 'Все', className: null },
  { label: 'Готовые', className: 'ready' },
  { label: 'Рабочие', className: 'working' },
  { label: 'Черновики', className: 'draft' },
];
let filterIndex = 0;

function updateCatalog() {
  const query = catalogSearch.value.trim().toLowerCase();
  const activeFilter = filterModes[filterIndex].className;
  const matchingCards = catalogCards.filter((card) => {
    const matchesQuery = card.textContent.toLowerCase().includes(query);
    const matchesFilter = !activeFilter || card.querySelector(`.status-pill.${activeFilter}`);
    return matchesQuery && matchesFilter;
  });
  const sortedCards = [...matchingCards].sort((a, b) => {
    if (catalogSort.selectedIndex === 1) return catalogCards.indexOf(a) - catalogCards.indexOf(b);
    return Number(b.querySelector('.task-score').textContent) - Number(a.querySelector('.task-score').textContent);
  });

  catalogCards.forEach((card) => { card.hidden = !matchingCards.includes(card); });
  sortedCards.forEach((card) => catalogGrid.appendChild(card));
  catalogEmpty.hidden = matchingCards.length > 0;
}

catalogSearch.addEventListener('input', updateCatalog);
catalogSort.addEventListener('change', updateCatalog);
filterButton.addEventListener('click', () => {
  filterIndex = (filterIndex + 1) % filterModes.length;
  const mode = filterModes[filterIndex];
  filterButton.querySelector('span').textContent = mode.label;
  filterButton.setAttribute('aria-label', `Фильтр: ${mode.label}`);
  updateCatalog();
});
updateStep();
