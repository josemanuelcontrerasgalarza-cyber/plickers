// src/normalizer/normalize.js
// Kratos Labs · Data Normalizer
//
// Output garantizado:
// {
//   sync_id, synced_at, class_id, class_name, source, extracted_at,
//   sessions: [{ session_id, session_title, session_date, total_questions,
//     students: [{ student_id, student_name, questions_answered,
//                  questions_correct, score, answers: [{question_id, answer, is_correct}] }]
//   }],
//   summary: { total_sessions, total_students, avg_score }
// }

import { randomUUID } from 'crypto';
import { PlickersDataParseError } from '../utils/errors.js';
import logger from '../utils/logger.js';

function parseScore(rawScore) {
  if (rawScore === null || rawScore === undefined) return 0;
  if (typeof rawScore === 'number') {
    return rawScore <= 1 ? Math.round(rawScore * 100) : Math.round(rawScore);
  }
  const str = String(rawScore).trim();
  if (str.endsWith('%')) return parseFloat(str) || 0;
  if (str.includes('/')) {
    const [num, den] = str.split('/').map(Number);
    if (den > 0) return Math.round((num / den) * 100);
  }
  return parseFloat(str) || 0;
}

function generateStudentId(name, index) {
  if (!name) return `student_${index}`;
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseDate(rawDate) {
  if (!rawDate) return null;
  try {
    const d = new Date(rawDate);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch { return null; }
}

function normalizeFromAPI(rawData) {
  const { classId, classData, sessions = [], sessionResults = {} } = rawData;
  const normalizedSessions = [];
  const allStudentIds = new Set();
  const allScores = [];

  for (const session of sessions) {
    const sessionId = session._id || session.id || randomUUID();
    const results = sessionResults[sessionId];
    let studentResults = [];

    if (results) {
      const rawResults = results.results || results.data || results.studentResults || (Array.isArray(results) ? results : []);
      studentResults = rawResults.map((r, idx) => {
        const studentId = r.student?._id || r.student?.id || r.studentId || generateStudentId(r.student?.name, idx);
        const studentName = r.student?.name || r.student?.displayName || r.studentName || null;
        const answers = (r.answers || r.responses || []).map((ans, qIdx) => ({
          question_id: ans.question || ans.questionId || `q_${qIdx}`,
          answer: ans.choice || ans.answer || null,
          is_correct: Boolean(ans.isCorrect || ans.correct),
        }));
        const questionsCorrect = answers.filter((a) => a.is_correct).length;
        const questionsAnswered = answers.length;
        const score = r.score !== undefined
          ? parseScore(r.score)
          : questionsAnswered > 0 ? Math.round((questionsCorrect / questionsAnswered) * 100) : 0;

        allStudentIds.add(studentId);
        allScores.push(score);

        return { student_id: String(studentId), student_name: studentName, questions_answered: questionsAnswered, questions_correct: questionsCorrect, score, answers };
      });
    }

    normalizedSessions.push({
      session_id: String(sessionId),
      session_title: session.title || session.name || null,
      session_date: parseDate(session.date || session.createdAt || session.startedAt),
      total_questions: session.questionsCount || session.totalQuestions || studentResults[0]?.answers?.length || 0,
      students: studentResults,
    });
  }

  return { sessions: normalizedSessions, allStudentIds, allScores, className: classData?.name || classData?.title || null };
}

function normalizeFromDOM(rawData) {
  const { sessions: domSessions = [] } = rawData;
  const normalizedSessions = [];
  const allStudentIds = new Set();
  const allScores = [];

  domSessions.forEach((session, sIdx) => {
    const students = (session.students || []).map((s, idx) => {
      const studentId = generateStudentId(s.name, idx);
      const score = parseScore(s.rawScore);
      allStudentIds.add(studentId);
      allScores.push(score);
      return { student_id: studentId, student_name: s.name || null, questions_answered: null, questions_correct: null, score, answers: [] };
    });

    normalizedSessions.push({
      session_id: `dom_session_${sIdx}`,
      session_title: session.title || null,
      session_date: parseDate(session.date),
      total_questions: null,
      students,
    });
  });

  return { sessions: normalizedSessions, allStudentIds, allScores, className: null };
}

export function normalizePlickersData(rawData) {
  if (!rawData || typeof rawData !== 'object') {
    throw new PlickersDataParseError('rawData es null o no es un objeto');
  }

  logger.info(`→ Normalizando datos (fuente: ${rawData.source})...`);

  let normalized;
  try {
    if (rawData.source === 'api_intercept') normalized = normalizeFromAPI(rawData);
    else if (rawData.source === 'dom_scrape') normalized = normalizeFromDOM(rawData);
    else throw new PlickersDataParseError(`Fuente desconocida: ${rawData.source}`);
  } catch (err) {
    if (err.name === 'PlickersDataParseError') throw err;
    throw new PlickersDataParseError(`Error durante normalización: ${err.message}`, rawData);
  }

  const { sessions, allStudentIds, allScores, className } = normalized;
  const avgScore = allScores.length > 0
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : 0;

  const result = {
    sync_id: randomUUID(),
    synced_at: new Date().toISOString(),
    class_id: rawData.classId,
    class_name: className,
    source: rawData.source,
    extracted_at: rawData.extractedAt,
    sessions,
    summary: { total_sessions: sessions.length, total_students: allStudentIds.size, avg_score: avgScore },
  };

  logger.info(`✓ Sesiones: ${result.summary.total_sessions} | Estudiantes: ${result.summary.total_students} | Promedio: ${result.summary.avg_score}%`);
  return result;
}
