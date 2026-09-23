# Контракт единого API EduTask

Базовый адрес: http://localhost:3000. Тело POST/PATCH — JSON-объект до 100 КБ.
Ошибки: {"error":"сообщение"}, HTTP 400/404/409/413/422/500.
Все маршруты доступны из одного процесса server.js.

## AI

POST /api/improve — {draft} → {improved}
POST /api/questions — {draft} → {questions}, минимум 3 вопроса
POST /api/generate — {draft, audience, subject, format, deadline, materials, constraint, answers:[{question,answer}]} → {title,context,result,criteria}
POST /api/review — {title,context,result,criteria} → {issues}
POST /api/match — {profile:{skills,deadline},tasks:[...]} → {matches:[{id,score,reason}]}
GET /api/health — {status,service,ai,model}

При демо возвращается demo:true, при ошибке провайдера также warning.
Structured Outputs ограничивает форму, но не гарантирует фактическую корректность; перед публикацией нужен человек.
Схемы AI включают только текстовые результаты, а не служебные id, status, score.

## Жизненный цикл задачи

| Запрос | Назначение |
| --- | --- |
| POST /api/tasks/draft | {rawDescription} (15–500 символов) → сохранённый черновик с id и questions, 201 |
| POST /api/tasks/:id/generate-card | {answers:{поля карточки},clarifications:[{question,answer}]} → сохранённая карточка |
| GET /api/tasks/:id | Черновик или опубликованная задача |
| PATCH /api/tasks/:id | Поля карточки; confirmed:true подтверждает изменения |
| POST /api/tasks/score | Поля карточки → предварительные score, level, breakdown, missingInformation |
| POST /api/tasks/:id/publish | {confirmed:true} → опубликованная задача |
| GET /api/tasks | {tasks:[...]} — все опубликованные задачи, включая выбранные и с низким рейтингом |
| GET /api/tasks/:id/proposals | {proposals:[...]} |
| POST /api/tasks/:id/proposals | {teamName,idea,plan,deadline,link} → отклик, 201 |
| PATCH /api/tasks/:id/proposals/:proposalId | {decision:"accepted"} или {decision:"rejected"} → {task,proposal} |

Поля карточки: title, context, users[], subject, format, materials, constraints[], expectedResult, successCriteria[], deadline, contact, interactionFormat.
GET возвращает также result=expectedResult и criteria=successCriteria.join("\\n") для совместимости интерфейса.
Точный формат: [task-schema.json](../api/task-schema.json).
Переданный клиентом score/status/id не применяется. Рейтинг считает сервер.
Публикация требует непустые title и context и явное подтверждение, но не порог рейтинга.
PATCH опубликованной задачи требует confirmed:true.
Повторная публикация не удаляет предложения и не сбрасывает выбор.
Ссылка предложения должна использовать http/https. Число откликов и принятых команд не ограничено.
Решение по одной команде не меняет статус остальных.

Параметры каталога: subject, level, q, sort=score (по умолчанию) или sort=newest.
status отражает процесс: draft / published / in_review / selected.
level отражает готовность: draft / working / ready / priority.
Рейтинг неподтверждённой карточки равен 0; /score показывает предварительную оценку после предполагаемого подтверждения.

## Пример заполнения

```json
{
  "title": "Интерактивный урок истории",
  "context": "Ученики запоминают даты, но не связывают причины и последствия событий.",
  "users": ["8 класс"],
  "subject": "История Казахстана",
  "format": "Интерактивный урок",
  "materials": "Учебная программа и материалы преподавателя",
  "constraints": ["45 минут"],
  "expectedResult": "Сценарий урока с заданиями и проверкой понимания",
  "successCriteria": ["3 задания", "10 вопросов теста"],
  "deadline": "2 недели",
  "contact": "teacher@example.test",
  "interactionFormat": "Консультация по почте",
  "confirmed": true
}
```

Роли демонстрационные, проверки личности и прав на сервере пока нет.
