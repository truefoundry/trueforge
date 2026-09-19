/** Auth and 422 bodies observed from api.typesafe.ai, plus the OpenAPI validation shape. */

export const MISSING_API_KEY_BODY = {
  detail: {
    error_type: 'authentication_error',
    message: 'Must supply an API key! Check your request and try again.',
  },
};

export const INVALID_API_KEY_BODY = {
  detail: {
    error_type: 'authentication_error',
    message: 'Cannot authenticate with the server. Please check your API key and try again.',
  },
};

export const INVALID_JSON_BODY = {
  detail: [
    {
      type: 'json_invalid',
      loc: ['body', 0],
      msg: 'JSON decode error',
      input: {},
      ctx: { error: 'Expecting value' },
    },
  ],
};

export const ACCEPTED_MODELS = ['jev-latest', 'jev-preview', 'jev-1.13.0'];

export const MODEL_LIST = {
  models: [
    {
      name: 'jev-latest',
      description: 'The most recent stable, official release. Points to jev-1.13.0.',
      release_date: '2026-09-15',
    },
    {
      name: 'jev-preview',
      description: 'The most recent release, whether or not it is an official one. Currently points to jev-1.13.0.',
      release_date: '2026-09-15',
    },
  ],
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonContent(value) {
  return typeof value === 'string' || Array.isArray(value) || isPlainObject(value);
}

function missing(loc, input) {
  return { type: 'missing', loc, msg: 'Field required', input };
}

function invalidContent(loc, input) {
  return {
    type: 'union_type',
    loc,
    msg: 'Input should be a string, object, or array',
    input,
  };
}

/**
 * Bearer token, or null when the header is absent, non-bearer, or blank.
 * The live API treats those cases as "no key" (403), not as a bad key (401).
 */
export function bearerToken(authorization) {
  if (typeof authorization !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (!match) {
    return null;
  }
  return match[1];
}

export function authenticate({ authorization, apiKey }) {
  const token = bearerToken(authorization);
  if (token === null) {
    return { ok: false, status: 403, body: MISSING_API_KEY_BODY };
  }
  if (apiKey !== null && token !== apiKey) {
    return { ok: false, status: 401, body: INVALID_API_KEY_BODY };
  }
  return { ok: true };
}

function validateQuestion({ id, question, errors }) {
  const loc = ['body', 'questions', id];
  if (!isPlainObject(question)) {
    errors.push({
      type: 'model_attributes_type',
      loc,
      msg: 'Input should be a valid dictionary or object to extract fields from',
      input: question,
    });
    return null;
  }

  const type = question.type;
  if (type !== 'noul' && type !== 'choice' && type !== 'score') {
    errors.push(
      type === undefined
        ? missing([...loc, 'type'], question)
        : {
            type: 'literal_error',
            loc: [...loc, 'type'],
            msg: "Input should be 'noul', 'choice', or 'score'",
            input: type,
          },
    );
    return null;
  }

  if (!Object.hasOwn(question, 'instructions')) {
    errors.push(missing([...loc, 'instructions'], question));
    return null;
  }
  if (!isJsonContent(question.instructions)) {
    errors.push(invalidContent([...loc, 'instructions'], question.instructions));
    return null;
  }

  if (type === 'noul') {
    return validateNoul({ id, question, errors, loc });
  }
  if (type === 'choice') {
    return validateChoice({ id, question, errors, loc });
  }
  return validateScore({ id, question, errors, loc });
}

function validateNoul({ question, errors, loc }) {
  const normalized = {
    type: 'noul',
    instructions: question.instructions,
  };
  if (!Object.hasOwn(question, 'criteria') || question.criteria === undefined) {
    return normalized;
  }
  if (question.criteria === null) {
    return { ...normalized, criteria: null };
  }
  if (!isPlainObject(question.criteria)) {
    errors.push({
      type: 'model_attributes_type',
      loc: [...loc, 'criteria'],
      msg: 'Input should be an object or null',
      input: question.criteria,
    });
    return null;
  }
  const criteria = {};
  for (const key of ['true', 'false']) {
    if (!Object.hasOwn(question.criteria, key)) {
      continue;
    }
    const description = question.criteria[key];
    if (description !== null && !isJsonContent(description)) {
      errors.push(invalidContent([...loc, 'criteria', key], description));
      return null;
    }
    criteria[key] = description;
  }
  return { ...normalized, criteria };
}

function validateChoice({ question, errors, loc }) {
  if (!Object.hasOwn(question, 'criteria')) {
    errors.push(missing([...loc, 'criteria'], question));
    return null;
  }
  if (!isPlainObject(question.criteria)) {
    errors.push({
      type: 'dict_type',
      loc: [...loc, 'criteria'],
      msg: 'Input should be an object mapping options to descriptions',
      input: question.criteria,
    });
    return null;
  }
  const keys = Object.keys(question.criteria);
  if (keys.length < 1) {
    errors.push({
      type: 'too_short',
      loc: [...loc, 'criteria'],
      msg: 'At least one option is required',
      input: question.criteria,
      ctx: { min_length: 1 },
    });
    return null;
  }
  const criteria = {};
  for (const key of keys) {
    const description = question.criteria[key];
    if (description !== null && !isJsonContent(description)) {
      errors.push(invalidContent([...loc, 'criteria', key], description));
      return null;
    }
    criteria[key] = description;
  }
  return { type: 'choice', instructions: question.instructions, criteria };
}

function validateScore({ question, errors, loc }) {
  if (!Object.hasOwn(question, 'criteria')) {
    errors.push(missing([...loc, 'criteria'], question));
    return null;
  }
  if (!Array.isArray(question.criteria)) {
    errors.push({
      type: 'list_type',
      loc: [...loc, 'criteria'],
      msg: 'Input should be an array of level descriptions',
      input: question.criteria,
    });
    return null;
  }
  if (question.criteria.length < 2) {
    errors.push({
      type: 'too_short',
      loc: [...loc, 'criteria'],
      msg: 'At least two levels are required',
      input: question.criteria,
      ctx: { min_length: 2, actual_length: question.criteria.length },
    });
    return null;
  }
  const criteria = [];
  for (let index = 0; index < question.criteria.length; index += 1) {
    const description = question.criteria[index];
    if (!isJsonContent(description)) {
      errors.push(invalidContent([...loc, 'criteria', index], description));
      return null;
    }
    criteria.push(description);
  }
  return { type: 'score', instructions: question.instructions, criteria };
}

/**
 * Validate a parsed JSON value against the systemone request.
 * Returns FastAPI-style `detail` entries; does not include the wrapping object.
 */
export function validateSystemOne(value) {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      errors: [
        {
          type: 'model_attributes_type',
          loc: ['body'],
          msg: 'Input should be a valid dictionary or object to extract fields from',
          input: value,
        },
      ],
    };
  }

  const errors = [];
  let state = null;
  let model = null;

  if (!Object.hasOwn(value, 'state')) {
    errors.push(missing(['body', 'state'], value));
  } else if (!isJsonContent(value.state)) {
    errors.push(invalidContent(['body', 'state'], value.state));
  } else {
    state = value.state;
  }

  if (!Object.hasOwn(value, 'model')) {
    errors.push(missing(['body', 'model'], value));
  } else if (typeof value.model !== 'string' || value.model.length === 0) {
    errors.push({
      type: 'string_type',
      loc: ['body', 'model'],
      msg: 'Input should be a non-empty string',
      input: value.model,
    });
  } else if (!ACCEPTED_MODELS.includes(value.model)) {
    errors.push({
      type: 'enum',
      loc: ['body', 'model'],
      msg: "Input should be 'jev-latest', 'jev-preview', or 'jev-1.13.0'",
      input: value.model,
    });
  } else {
    model = value.model;
  }

  const questions = {};
  if (!Object.hasOwn(value, 'questions')) {
    errors.push(missing(['body', 'questions'], value));
  } else if (!isPlainObject(value.questions)) {
    errors.push({
      type: 'dict_type',
      loc: ['body', 'questions'],
      msg: 'Input should be an object mapping question ids to questions',
      input: value.questions,
    });
  } else if (Object.keys(value.questions).length < 1) {
    errors.push({
      type: 'too_short',
      loc: ['body', 'questions'],
      msg: 'At least one question is required',
      input: value.questions,
      ctx: { min_length: 1 },
    });
  } else {
    for (const [id, question] of Object.entries(value.questions)) {
      const normalized = validateQuestion({ id, question, errors });
      if (normalized !== null) {
        questions[id] = normalized;
      }
    }
  }

  if (errors.length > 0 || state === null || model === null) {
    return { ok: false, errors };
  }

  return { ok: true, request: { state, model, questions } };
}
