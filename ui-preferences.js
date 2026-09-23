// Theme, profile and local text draft from the UI branch, independent of server task storage.
(() => {
  function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function write(key, value) {
    try { localStorage.setItem(key, value); return true; }
    catch { showToast('Браузер не разрешил сохранить настройки'); return false; }
  }
  const themeToggle = $('#themeToggle');
  function setTheme(dark) {
    document.body.classList.toggle('dark-theme', dark);
    themeToggle.textContent = dark ? '☀' : '☾';
    themeToggle.setAttribute('aria-pressed', String(dark));
  }
  setTheme(read('edutask-theme') === 'dark');
  themeToggle.addEventListener('click', () => {
    const dark = !document.body.classList.contains('dark-theme');
    setTheme(dark);
    write('edutask-theme', dark ? 'dark' : 'light');
  });

  const profileToggle = $('#profileToggle'), profilePanel = $('#profilePanel');
  const profileForm = $('#profileForm');
  const inputs = { firstName: $('#profileFirstNameInput'), lastName: $('#profileLastNameInput'), phone: $('#profilePhoneInput'), email: $('#profileEmailInput') };
  const defaults = { firstName: 'Дамир', lastName: 'Боталбаев', phone: '+7 (700) 000-00-00', email: 'damir@edutask.kz' };
  let saved = {};
  try { const parsed = JSON.parse(read('edutask-profile') || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) saved = parsed; } catch {}
  if (typeof saved.name === 'string' && !saved.firstName) {
    const parts = saved.name.trim().split(/\s+/);
    saved.firstName = parts.shift(); saved.lastName = parts.join(' ');
  }
  let profile = Object.fromEntries(Object.keys(defaults).map(key => [key, typeof saved[key] === 'string' ? saved[key].slice(0, 200) : defaults[key]]));
  function renderProfile() {
    const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    $('.profile-name').textContent = fullName;
    $('.profile-avatar').textContent = fullName.split(/\s+/).filter(Boolean).map(x => x[0]).slice(0, 2).join('').toUpperCase() || 'П';
    for (const [key, input] of Object.entries(inputs)) { input.value = profile[key]; input.maxLength = 200; }
  }
  function closeProfile() { profilePanel.hidden = true; profileToggle.setAttribute('aria-expanded', 'false'); }
  renderProfile();
  profileToggle.addEventListener('click', () => {
    profilePanel.hidden = !profilePanel.hidden;
    profileToggle.setAttribute('aria-expanded', String(!profilePanel.hidden));
    if (!profilePanel.hidden) inputs.firstName.focus();
  });
  $('#profileCancel').addEventListener('click', () => { renderProfile(); closeProfile(); });
  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    const changed = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]));
    if (!changed.firstName || !changed.lastName) { showToast('Введите имя и фамилию'); return; }
    if (!write('edutask-profile', JSON.stringify(changed))) return;
    profile = changed; renderProfile(); closeProfile(); showToast('Профиль сохранён в этом браузере');
  });
  document.addEventListener('click', event => { if (!profilePanel.hidden && !profilePanel.contains(event.target) && !profileToggle.contains(event.target)) closeProfile(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !profilePanel.hidden) { closeProfile(); profileToggle.focus(); } });

  const quickExamples = {
    interactive: 'Хочу создать интерактивный урок по истории Казахстана для 8 класса с картой событий и коротким квизом.',
    quiz: 'Нужен способ проверить знания учеников по теме через короткую викторину с понятной обратной связью.',
    project: 'Хочу запустить проектное задание, в котором студенты разработают решение для реальной образовательной задачи.',
    adaptation: 'Нужно адаптировать сложный учебный материал для учеников с разным уровнем подготовки и темпом обучения.'
  };
  const savedDraft = read('edutask-draft');
  if (savedDraft && !draftInput.value) { draftInput.value = savedDraft.slice(0, 500); $('#charCount').textContent = draftInput.value.length; }
  draftInput.addEventListener('input', () => { write('edutask-draft', draftInput.value); updateStep(); });
  for (const button of document.querySelectorAll('[data-example]')) button.addEventListener('click', () => {
    draftInput.value = quickExamples[button.dataset.example];
    draftInput.dispatchEvent(new Event('input', { bubbles: true }));
    draftInput.focus();
  });
  document.addEventListener('edutask:published', () => {
    try { localStorage.removeItem('edutask-draft'); } catch {}
  });
  updateStep();
})();
