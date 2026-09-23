const scoringRules = [
  { field: 'context', points: 20, test: (value) => typeof value === 'string' && value.trim().length >= 30, missing: 'Добавьте контекст и конкретную проблему' },
  { field: 'materials', points: 20, test: (value) => typeof value === 'string' && value.trim().length >= 10, missing: 'Укажите доступные материалы и данные' },
  { field: 'expectedResult', points: 15, test: (value) => typeof value === 'string' && value.trim().length >= 20, missing: 'Опишите ожидаемый результат' },
  { field: 'successCriteria', points: 15, test: (value) => Array.isArray(value) && value.length >= 2, missing: 'Добавьте минимум два критерия успеха' },
  { field: 'constraints', points: 10, test: (value) => Array.isArray(value) && value.length > 0, missing: 'Укажите ограничения задачи' },
  { field: 'users', points: 10, test: (value) => Array.isArray(value) && value.length > 0, missing: 'Укажите пользователей и целевую аудиторию' },
  { field: 'contact', points: 10, test: (value) => typeof value === 'string' && value.trim().length >= 5, missing: 'Укажите контакт и формат обратной связи' }
];

function getLevel(score) {
  if (score >= 90) return 'priority';
  if (score >= 70) return 'ready';
  if (score >= 40) return 'working';
  return 'draft';
}

function calculateScore(task) {
  const missingInformation = [];
  const breakdown = {};
  let score = 0;

  scoringRules.forEach((rule) => {
    let value = Array.isArray(task[rule.field]) ? task[rule.field].filter(x => typeof x === 'string' && x.trim()) : task[rule.field];
    if (rule.field === 'constraints' && typeof task.deadline === 'string' && task.deadline.trim()) value = [...(Array.isArray(value) ? value : []), task.deadline];
    const passed = task.confirmed === true && rule.test(value) && (rule.field !== 'contact' || Boolean(task.interactionFormat?.trim()));
    breakdown[rule.field] = { points: passed ? rule.points : 0, maxPoints: rule.points, passed };
    if (passed) score += rule.points;
    else missingInformation.push(rule.missing);
  });

  return { score, level: getLevel(score), missingInformation, breakdown };
}

module.exports = { calculateScore, getLevel };
