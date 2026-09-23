const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const OPENAI_KEY = process.env.OPENAI_API_KEY;

app.post('/api/improve', async (req, res) => {
  const draft = typeof req.body?.draft === 'string' ? req.body.draft.trim() : '';
  if (draft.length < 15 || draft.length > 500) {
    return res.status(400).json({ error: 'Описание должно содержать от 15 до 500 символов.' });
  }
  try {
    if (!OPENAI_KEY) {
      return res.json({ improved: `${draft.replace(/[.!?\s]+$/, '')}. Уточните учебную цель, целевую аудиторию и ожидаемый результат, сохранив исходную идею.` });
    }

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Ты помощник образовательной платформы. Улучши описание педагогической задачи на русском: сохрани исходный смысл, сделай формулировку яснее и конкретнее, не выдумывай факты. Верни только улучшенный текст, не более 500 символов.' },
          { role: 'user', content: draft }
        ],
        max_tokens: 180,
        temperature: 0.3,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(502).json({ error: 'AI service error' });
    const improved = data?.choices?.[0]?.message?.content?.trim();
    if (!improved) return res.status(502).json({ error: 'AI returned an empty response' });
    return res.json({ improved: improved.slice(0, 500) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Improvement failed' });
  }
});

app.post('/api/generate', async (req, res) => {
  const { draft, audience, subject, format, deadline, materials, constraint } = req.body || {};
  try {
    if (!OPENAI_KEY) {
      // Return a deterministic mock when no API key is provided
      return res.json({
        title: `${format || 'Интерактивный урок'} по предмету «${subject || 'Предмет'}»`,
        context: `${draft || 'Описание задачи'}\n\nЦелевая аудитория: ${audience || 'Не указано'}. Уже есть: ${materials || 'Нет'}.`,
        result: `Готовый ${format ? format.toLowerCase() : 'материал'} для ${audience || 'аудитории'} со структурой занятия, заданиями и способом проверить понимание темы. Срок: ${deadline || 'не указан'}.`,
        criteria: `Понятная структура урока\nМинимум 3 практических задания\nУчтено ограничение: ${constraint || 'нет'}`
      });
    }

    // Call OpenAI Chat Completions API
    const prompt = `На основе следующих данных сформируй JSON с полями: title, context, result, criteria.\nДанные:\nОписание: ${draft}\nАудитория: ${audience}\nПредмет: ${subject}\nФормат: ${format}\nСрок: ${deadline}\nМатериалы: ${materials}\nОграничения: ${constraint}`;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 600,
        temperature: 0.2,
      }),
    });

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || '';

    // Try to parse JSON from the model; fall back to a simple text extraction
    try {
      const parsed = JSON.parse(text);
      return res.json(parsed);
    } catch (e) {
      // Fallback: return wrapped text into context
      return res.json({ title: `${format || 'Задача'}`, context: text, result: '', criteria: '' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Generation failed', details: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`AI mock/server listening on http://localhost:${port}`));
