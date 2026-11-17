#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const evalDir = path.join(process.cwd(), 'data', 'eval');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

const [taskText, susText] = await Promise.all([
  fs.readFile(path.join(evalDir, 'user-study-template.csv'), 'utf8'),
  fs.readFile(path.join(evalDir, 'sus-template.csv'), 'utf8'),
]);
const tasks = parseCsv(taskText).filter((row) => row.consent_confirmed === 'true' && ['true', 'false'].includes(row.success));
const susRows = parseCsv(susText).filter((row) => {
  if (row.consent_confirmed !== 'true') return false;
  return Array.from({ length: 10 }, (_, index) => Number(row[`q${index + 1}`])).every((value) => value >= 1 && value <= 5);
});

const susScores = susRows.map((row) => {
  const adjusted = Array.from({ length: 10 }, (_, index) => {
    const answer = Number(row[`q${index + 1}`]);
    return index % 2 === 0 ? answer - 1 : 5 - answer;
  });
  return adjusted.reduce((sum, value) => sum + value, 0) * 2.5;
});
const durations = tasks.map((row) => Number(row.duration_seconds)).filter(Number.isFinite);
const report = {
  generatedAt: new Date().toISOString(),
  status: tasks.length > 0 || susScores.length > 0 ? 'partial_or_completed' : 'awaiting_real_participants',
  disclaimer: '仅汇总已确认同意且填写完整的匿名真人记录；空模板不产生任何用户研究结论。',
  summary: {
    participants: new Set([...tasks.map((row) => row.participant_id), ...susRows.map((row) => row.participant_id)]).size,
    completedTasks: tasks.length,
    taskSuccessRate: tasks.length ? Number((tasks.filter((row) => row.success === 'true').length / tasks.length).toFixed(3)) : null,
    averageTaskSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    susResponses: susScores.length,
    averageSus: susScores.length ? Number((susScores.reduce((sum, value) => sum + value, 0) / susScores.length).toFixed(1)) : null,
  },
};

const out = path.join(evalDir, 'user-study-summary.json');
await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`用户试用汇总：${report.status} · 参与者 ${report.summary.participants} · 完成任务 ${report.summary.completedTasks} · SUS ${report.summary.susResponses} 份`);
console.log(`结果：${path.relative(process.cwd(), out)}`);
