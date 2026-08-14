import { createClient } from 'redis';

const STORE_KEY = 'action-card-questions-v1';
const EDUCATOR_PIN = process.env.EDUCATOR_PIN || '2468';

let clientPromise = null;
function getClient() {
  if (!clientPromise) {
    const client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis Client Error', err));
    clientPromise = client.connect()
      .then(() => client)
      .catch((err) => { clientPromise = null; throw err; });
  }
  return clientPromise;
}

async function readAll(client) {
  const raw = await client.get(STORE_KEY);
  return raw ? JSON.parse(raw) : [];
}
async function writeAll(client, list) {
  await client.set(STORE_KEY, JSON.stringify(list));
}

function anonymize(q) {
  return {
    qId: q.qId, cardId: q.cardId, cardTitle: q.cardTitle,
    question: q.question, dateSubmitted: q.dateSubmitted,
    status: q.status, answer: q.answer, dateAnswered: q.dateAnswered,
  };
}

export default async function handler(req, res) {
  const client = await getClient();

  if (req.method === 'GET') {
    const all = await readAll(client);
    const pin = req.query.pin;
    if (pin) {
      if (pin !== EDUCATOR_PIN) { res.status(403).json({ error: 'Incorrect PIN' }); return; }
      res.status(200).json({ questions: all });
      return;
    }
    res.status(200).json({ questions: all.filter(q => q.status === 'Answered').map(anonymize) });
    return;
  }

  if (req.method === 'POST') {
    const { staffName, cardId, cardTitle, question } = req.body || {};
    if (!staffName || !cardId || !cardTitle || !question) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }
    const all = await readAll(client);
    const entry = {
      qId: 'Q' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      staffName: String(staffName).slice(0, 200),
      cardId: String(cardId),
      cardTitle: String(cardTitle),
      question: String(question).slice(0, 2000),
      status: 'Pending',
      dateSubmitted: new Date().toISOString().slice(0, 10),
      answeredBy: '', answer: '', dateAnswered: '',
    };
    all.push(entry);
    await writeAll(client, all);
    res.status(201).json({ question: entry });
    return;
  }

  if (req.method === 'PATCH') {
    const { pin, qId, answeredBy, answer } = req.body || {};
    if (pin !== EDUCATOR_PIN) { res.status(403).json({ error: 'Incorrect PIN' }); return; }
    if (!qId || !answeredBy || !answer) { res.status(400).json({ error: 'Missing required fields' }); return; }
    const all = await readAll(client);
    const entry = all.find(q => q.qId === qId);
    if (!entry) { res.status(404).json({ error: 'Question not found' }); return; }
    entry.status = 'Answered';
    entry.answeredBy = String(answeredBy).slice(0, 200);
    entry.answer = String(answer).slice(0, 2000);
    entry.dateAnswered = new Date().toISOString().slice(0, 10);
    await writeAll(client, all);
    res.status(200).json({ question: entry });
    return;
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  res.status(405).json({ error: 'Method not allowed' });
}
