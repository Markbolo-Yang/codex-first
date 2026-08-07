'use strict';

function emptyReport() {
  return {
    overview: '',
    advantages: [],
    improve: { base_info: [], projects: [] },
    optimize_ref: [],
    final_tips: null
  };
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
}

function normalizeReport(value) {
  const source = value && typeof value === 'object' ? value : {};
  const improve = source.improve && typeof source.improve === 'object' ? source.improve : {};
  const projects = Array.isArray(improve.projects)
    ? improve.projects.map(project => ({
      project_name: typeof project?.project_name === 'string' ? project.project_name : '',
      points: normalizeStringList(project?.points)
    })).filter(project => project.project_name || project.points.length)
    : [];
  const optimizeRef = Array.isArray(source.optimize_ref)
    ? source.optimize_ref.map(item => ({
      project_name: typeof item?.project_name === 'string' ? item.project_name : '',
      original_text: typeof item?.original_text === 'string' ? item.original_text : '',
      optimize_content: typeof item?.optimize_content === 'string' ? item.optimize_content : ''
    })).filter(item => item.project_name || item.original_text || item.optimize_content)
    : [];

  return {
    overview: typeof source.overview === 'string' ? source.overview : '',
    advantages: normalizeStringList(source.advantages),
    improve: {
      base_info: normalizeStringList(improve.base_info),
      projects
    },
    optimize_ref: optimizeRef,
    final_tips: source.final_tips || null
  };
}

function trimIncompleteEscape(candidate) {
  if (/\\$/.test(candidate)) return candidate.slice(0, -1);
  const unicodeTail = candidate.match(/\\u[0-9a-fA-F]{0,3}$/);
  return unicodeTail ? candidate.slice(0, -unicodeTail[0].length) : candidate;
}

// 将尚未结束的模型 JSON 补成一个可解析快照。无法安全补全时返回 null，
// 页面保留上一份快照，绝不把 JSON 标点或字段名直接展示给用户。
function completePartialJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let candidate = raw.trim();
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (char === ']' && stack[stack.length - 1] === '[') stack.pop();
  }

  if (inString) {
    candidate = trimIncompleteEscape(candidate) + '"';
  }
  candidate = candidate.replace(/,\s*$/, '');
  if (/[:]\s*$/.test(candidate)) candidate += 'null';
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    candidate += stack[index] === '{' ? '}' : ']';
  }
  return candidate;
}

function parseStreamingReport(raw) {
  const completed = completePartialJson(raw);
  if (!completed) return null;
  try {
    return normalizeReport(JSON.parse(completed));
  } catch (error) {
    return null;
  }
}

function hasReportContent(report) {
  return Boolean(
    report?.overview ||
    report?.advantages?.length ||
    report?.improve?.base_info?.length ||
    report?.improve?.projects?.length ||
    report?.optimize_ref?.length
  );
}

module.exports = {
  emptyReport,
  normalizeReport,
  parseStreamingReport,
  hasReportContent
};
