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

function growText(current, target, budget) {
  const from = typeof current === 'string' ? current : '';
  const to = typeof target === 'string' ? target : '';
  if (!to.startsWith(from)) return to;
  if (from.length >= to.length || budget.left <= 0) return from;
  const amount = Math.min(budget.left, to.length - from.length);
  budget.left -= amount;
  return from + to.slice(from.length, from.length + amount);
}

function growStringList(current, target, budget) {
  const output = Array.isArray(current) ? current.slice() : [];
  for (let index = 0; index < target.length && budget.left > 0; index += 1) {
    const before = output[index] || '';
    const after = growText(before, target[index], budget);
    if (after || index < output.length) output[index] = after;
  }
  return output;
}

// 每个动画节拍只释放少量自然语言字符，避免数据库批量 chunk 整块跳出。
function advanceReportDisplay(currentValue, targetValue, charBudget = 8) {
  const current = normalizeReport(currentValue);
  const target = normalizeReport(targetValue);
  const budget = { left: Math.max(1, Number(charBudget) || 1) };
  const next = emptyReport();

  next.overview = growText(current.overview, target.overview, budget);
  next.advantages = growStringList(current.advantages, target.advantages, budget);
  next.improve.base_info = growStringList(
    current.improve.base_info,
    target.improve.base_info,
    budget
  );

  const currentProjects = current.improve.projects;
  for (let index = 0; index < target.improve.projects.length && budget.left > 0; index += 1) {
    const targetProject = target.improve.projects[index];
    const currentProject = currentProjects[index] || { project_name: '', points: [] };
    const project = {
      project_name: growText(currentProject.project_name, targetProject.project_name, budget),
      points: growStringList(currentProject.points, targetProject.points, budget)
    };
    if (project.project_name || project.points.length) next.improve.projects[index] = project;
  }
  // 已展示但本节拍还未轮到的内容必须保留。
  currentProjects.forEach((project, index) => {
    if (!next.improve.projects[index]) next.improve.projects[index] = project;
  });

  const currentReferences = current.optimize_ref;
  for (let index = 0; index < target.optimize_ref.length && budget.left > 0; index += 1) {
    const targetReference = target.optimize_ref[index];
    const currentReference = currentReferences[index] || {
      project_name: '',
      original_text: '',
      optimize_content: ''
    };
    const reference = {
      project_name: growText(currentReference.project_name, targetReference.project_name, budget),
      original_text: growText(currentReference.original_text, targetReference.original_text, budget),
      optimize_content: growText(
        currentReference.optimize_content,
        targetReference.optimize_content,
        budget
      )
    };
    if (reference.project_name || reference.original_text || reference.optimize_content) {
      next.optimize_ref[index] = reference;
    }
  }
  currentReferences.forEach((reference, index) => {
    if (!next.optimize_ref[index]) next.optimize_ref[index] = reference;
  });
  next.final_tips = target.final_tips;

  return {
    report: next,
    done: JSON.stringify(next) === JSON.stringify(target)
  };
}

module.exports = {
  emptyReport,
  normalizeReport,
  parseStreamingReport,
  hasReportContent,
  advanceReportDisplay
};
