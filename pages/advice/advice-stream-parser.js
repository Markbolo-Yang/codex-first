'use strict';

function emptyAdvice() {
  return {
    profileOverview: '',
    keyExaminePoint: [],
    matchAdvice: '',
    interviewSkillGuide: {
      selfIntro: '',
      projectRule: '',
      interviewHabit: ''
    },
    questionList: []
  };
}

function strings(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

function normalizeAdvice(value) {
  const source = value && typeof value === 'object' ? value : {};
  const guide = source.interviewSkillGuide && typeof source.interviewSkillGuide === 'object'
    ? source.interviewSkillGuide
    : {};
  return {
    profileOverview: typeof source.profileOverview === 'string' ? source.profileOverview : '',
    keyExaminePoint: strings(source.keyExaminePoint),
    matchAdvice: typeof source.matchAdvice === 'string' ? source.matchAdvice : '',
    interviewSkillGuide: {
      selfIntro: typeof guide.selfIntro === 'string' ? guide.selfIntro : '',
      projectRule: typeof guide.projectRule === 'string' ? guide.projectRule : '',
      interviewHabit: typeof guide.interviewHabit === 'string' ? guide.interviewHabit : ''
    },
    questionList: Array.isArray(source.questionList)
      ? source.questionList.map(item => ({
        title: typeof item?.title === 'string' ? item.title : '',
        thinking: typeof item?.thinking === 'string' ? item.thinking : '',
        sampleAnswer: typeof item?.sampleAnswer === 'string' ? item.sampleAnswer : ''
      })).filter(item => item.title || item.thinking || item.sampleAnswer)
      : []
  };
}

function trimIncompleteEscape(value) {
  if (/\\$/.test(value)) return value.slice(0, -1);
  const unicodeTail = value.match(/\\u[0-9a-fA-F]{0,3}$/);
  return unicodeTail ? value.slice(0, -unicodeTail[0].length) : value;
}

function completePartialJson(raw) {
  if (typeof raw !== 'string') return null;
  const objectStart = raw.indexOf('{');
  if (objectStart < 0) return null;
  let candidate = raw.slice(objectStart).trim();
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const char of candidate) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (char === ']' && stack[stack.length - 1] === '[') stack.pop();
  }

  if (inString) candidate = trimIncompleteEscape(candidate) + '"';
  candidate = candidate.replace(/,\s*$/, '');
  if (/:\s*$/.test(candidate)) candidate += 'null';
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    candidate += stack[index] === '{' ? '}' : ']';
  }
  return candidate;
}

function parseStreamingAdvice(raw) {
  const completed = completePartialJson(raw);
  if (!completed) return null;
  try {
    return normalizeAdvice(JSON.parse(completed));
  } catch (error) {
    return null;
  }
}

function hasAdviceContent(advice) {
  return Boolean(
    advice?.profileOverview ||
    advice?.keyExaminePoint?.length ||
    advice?.matchAdvice ||
    advice?.interviewSkillGuide?.selfIntro ||
    advice?.interviewSkillGuide?.projectRule ||
    advice?.interviewSkillGuide?.interviewHabit ||
    advice?.questionList?.length
  );
}

module.exports = {
  emptyAdvice,
  normalizeAdvice,
  parseStreamingAdvice,
  hasAdviceContent
};
