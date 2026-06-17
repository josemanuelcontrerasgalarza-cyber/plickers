// tests/test.js
// Ejecutar: node tests/test.js

import 'dotenv/config';
import { normalizePlickersData } from '../src/normalizer/normalize.js';

let passed = 0, failed = 0;

function assert(condition, testName) {
  if (condition) { console.log(`  ✅ PASS: ${testName}`); passed++; }
  else { console.error(`  ❌ FAIL: ${testName}`); failed++; }
}

const mockAPIData = {
  source: 'api_intercept',
  classId: 'test-class-123',
  extractedAt: new Date().toISOString(),
  classData: { name: '6to Grado A', _id: 'test-class-123' },
  sessions: [
    { _id: 'session-001', title: 'Matemáticas - Fracciones', date: '2024-06-10T10:00:00Z', questionsCount: 5 },
    { _id: 'session-002', title: 'Ciencias - Fotosíntesis', date: '2024-06-12T10:00:00Z', questionsCount: 4 },
  ],
  sessionResults: {
    'session-001': {
      results: [
        { student: { _id: 'stu-1', name: 'Ana García' }, score: 0.8,
          answers: [{ question: 'q1', choice: 'A', isCorrect: true },{ question: 'q2', choice: 'B', isCorrect: true },{ question: 'q3', choice: 'C', isCorrect: false },{ question: 'q4', choice: 'A', isCorrect: true },{ question: 'q5', choice: 'D', isCorrect: true }] },
        { student: { _id: 'stu-2', name: 'Carlos López' }, score: 0.6,
          answers: [{ question: 'q1', choice: 'B', isCorrect: false },{ question: 'q2', choice: 'B', isCorrect: true },{ question: 'q3', choice: 'A', isCorrect: false },{ question: 'q4', choice: 'A', isCorrect: true },{ question: 'q5', choice: 'D', isCorrect: true }] },
      ],
    },
    'session-002': {
      results: [
        { student: { _id: 'stu-1', name: 'Ana García' }, score: 1.0,
          answers: [{ question: 'q1', choice: 'A', isCorrect: true },{ question: 'q2', choice: 'C', isCorrect: true },{ question: 'q3', choice: 'B', isCorrect: true },{ question: 'q4', choice: 'D', isCorrect: true }] },
      ],
    },
  },
};

const mockDOMData = {
  source: 'dom_scrape',
  classId: 'test-class-456',
  extractedAt: new Date().toISOString(),
  sessions: [{ title: 'Quiz rápido', date: '2024-06-15', students: [{ name: 'María Pérez', rawScore: '90%' }, { name: 'Juan Torres', rawScore: '7/10' }] }],
};

console.log('\n🧪 Kratos Labs · Plickers Normalizer Tests\n');

console.log('Test 1: Datos de API interna');
try {
  const r = normalizePlickersData(mockAPIData);
  assert(r.sync_id !== undefined, 'sync_id generado');
  assert(r.class_id === 'test-class-123', 'class_id correcto');
  assert(r.class_name === '6to Grado A', 'class_name correcto');
  assert(r.source === 'api_intercept', 'source = api_intercept');
  assert(r.sessions.length === 2, 'Dos sesiones');
  assert(r.summary.total_sessions === 2, 'summary.total_sessions = 2');
  assert(r.summary.total_students === 2, 'Dos estudiantes únicos');
  const ana = r.sessions[0].students.find(s => s.student_id === 'stu-1');
  assert(ana?.score === 80, `Score Ana = 80 (got ${ana?.score})`);
  assert(ana?.questions_correct === 4, 'questions_correct Ana');
  assert(ana?.questions_answered === 5, 'questions_answered Ana = 5');
  const carlos = r.sessions[0].students.find(s => s.student_id === 'stu-2');
  assert(carlos?.score === 60, `Score Carlos = 60 (got ${carlos?.score})`);
  assert(carlos?.questions_correct === 3, 'questions_correct Carlos = 3');
} catch (err) { console.error(`  ❌ EXCEPCIÓN: ${err.message}`); failed++; }

console.log('\nTest 2: Datos DOM (fallback)');
try {
  const r = normalizePlickersData(mockDOMData);
  assert(r.sessions.length === 1, 'Una sesión');
  assert(r.source === 'dom_scrape', 'source = dom_scrape');
  assert(r.sessions[0].students[0].score === 90, 'Score María = 90%');
  assert(r.sessions[0].students[1].score === 70, 'Score Juan = 7/10 → 70');
  assert(r.sessions[0].students[0].student_name === 'María Pérez', 'student_name María correcto');
  assert(r.sessions[0].students[0].questions_answered === null, 'DOM sin questions_answered (null)');
} catch (err) { console.error(`  ❌ EXCEPCIÓN: ${err.message}`); failed++; }

console.log('\nTest 3: Manejo de errores');
try {
  normalizePlickersData(null);
  console.error('  ❌ Debió lanzar error'); failed++;
} catch (err) { assert(err.name === 'PlickersDataParseError', 'null lanza PlickersDataParseError'); }
try {
  normalizePlickersData({ source: 'fuente_inexistente', classId: 'x' });
  console.error('  ❌ Debió lanzar error'); failed++;
} catch (err) { assert(err.name === 'PlickersDataParseError', 'fuente desconocida lanza PlickersDataParseError'); }

console.log('\nTest 4: Estructura garantizada del output');
try {
  const r = normalizePlickersData(mockAPIData);
  assert(typeof r.sync_id === 'string', 'sync_id es string');
  assert(r.class_id === 'test-class-123', 'class_id presente en output');
  assert(Array.isArray(r.sessions), 'sessions es array');
  assert(r.summary.avg_score >= 0 && r.summary.avg_score <= 100, 'avg_score en rango 0-100');
} catch (err) { console.error(`  ❌ EXCEPCIÓN: ${err.message}`); failed++; }

console.log(`\n${'─'.repeat(40)}`);
console.log(`Resultado: ${passed} ✅ passed, ${failed} ❌ failed`);
console.log(`${'─'.repeat(40)}\n`);
process.exit(failed > 0 ? 1 : 0);
