/**
 * Every answer is the published example, not a model call.
 * Exact doc requests return that JSON. Any other request reuses the same numbers.
 */

const USAGE = { input_tokens: 312, output_tokens: 48 };

const PAYOUT_STATE = 'Help! My payouts have been failing for 3 days.';

export const documentedExamples = [
  {
    name: 'noul',
    request: {
      state: PAYOUT_STATE,
      model: 'jev-latest',
      questions: {
        is_urgent: {
          type: 'noul',
          instructions: 'Does this convey urgency?',
        },
      },
    },
    response: {
      model: 'jev-latest',
      answers: {
        is_urgent: { type: 'noul', noul: 0.92 },
      },
      usage: USAGE,
    },
  },
  {
    name: 'choice',
    request: {
      state: PAYOUT_STATE,
      model: 'jev-latest',
      questions: {
        department: {
          type: 'choice',
          instructions: 'Which team should handle this?',
          criteria: {
            billing: 'Payments, invoicing, refunds',
            technical: 'Bugs, outages, integrations',
            sales: 'Pricing, upgrades, new accounts',
          },
        },
      },
    },
    response: {
      model: 'jev-latest',
      answers: {
        department: {
          type: 'choice',
          choice: 'technical',
          probabilities: { billing: 0.08, technical: 0.85, sales: 0.07 },
          confidence: 0.82,
        },
      },
      usage: USAGE,
    },
  },
  {
    name: 'score',
    request: {
      state: PAYOUT_STATE,
      model: 'jev-latest',
      questions: {
        frustration: {
          type: 'score',
          instructions: 'How frustrated is the customer?',
          criteria: ['Calm', 'Frustrated', 'Very angry'],
        },
      },
    },
    response: {
      model: 'jev-latest',
      answers: {
        frustration: {
          type: 'score',
          score: 1.6,
          legend: { 0: 'Calm', 1: 'Frustrated', 2: 'Very angry' },
          probabilities: { 0: 0.05, 1: 0.3, 2: 0.65 },
          confidence: 0.78,
        },
      },
      usage: USAGE,
    },
  },
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(item => stable(item));
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = stable(value[key]);
  }
  return sorted;
}

function sameRequest(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function fixedChoice(criteria) {
  const keys = Object.keys(criteria);
  const probabilities = {};
  if (keys.length === 1) {
    probabilities[keys[0]] = 1;
    return { type: 'choice', choice: keys[0], probabilities, confidence: 0.82 };
  }
  if (keys.length === 2) {
    probabilities[keys[0]] = 0.15;
    probabilities[keys[1]] = 0.85;
    return { type: 'choice', choice: keys[1], probabilities, confidence: 0.82 };
  }
  const weights = [0.08, 0.85, 0.07];
  keys.forEach((key, index) => {
    probabilities[key] = index < weights.length ? weights[index] : 0;
  });
  return { type: 'choice', choice: keys[1], probabilities, confidence: 0.82 };
}

function fixedScore(criteria) {
  const legend = {};
  const probabilities = {};
  criteria.forEach((description, index) => {
    legend[String(index)] = description;
    probabilities[String(index)] = 0;
  });
  if (criteria.length === 2) {
    probabilities['0'] = 0.35;
    probabilities['1'] = 0.65;
    return { type: 'score', score: 0.65, legend, probabilities, confidence: 0.78 };
  }
  const weights = [0.05, 0.3, 0.65];
  weights.forEach((weight, index) => {
    if (index < criteria.length) {
      probabilities[String(index)] = weight;
    }
  });
  return { type: 'score', score: 1.6, legend, probabilities, confidence: 0.78 };
}

function answerQuestion(question) {
  if (question.type === 'noul') {
    return { type: 'noul', noul: 0.92 };
  }
  if (question.type === 'choice') {
    return fixedChoice(question.criteria);
  }
  return fixedScore(question.criteria);
}

export function evaluate(request) {
  for (const example of documentedExamples) {
    if (sameRequest(example.request, request)) {
      return structuredClone(example.response);
    }
  }

  const answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    answers[id] = answerQuestion(question);
  }
  return {
    model: request.model,
    answers,
    usage: USAGE,
  };
}
