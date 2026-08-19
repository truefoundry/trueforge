// These checks provide immediate form feedback; server schemas remain authoritative for every request.
const RESOURCE_NAME_PATTERN = /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$/;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const GIT_REPOSITORY_URL_PATTERN =
  /^https:\/\/(github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+|gitlab\.com\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+)(\/|\.git)?$/;
const GIT_REF_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const GIT_PATH_PATTERN = /^[A-Za-z0-9._\-/]+$/;

function containsParentTraversal(value: string): boolean {
  return value.split('/').includes('..');
}

function isDuplicate({
  value,
  existingValues,
  originalValue,
  caseSensitive = true,
}: {
  value: string;
  existingValues: readonly string[];
  originalValue?: string;
  caseSensitive?: boolean;
}): boolean {
  const normalize = (candidate: string) => (caseSensitive ? candidate.trim() : candidate.trim().toLowerCase());
  const normalizedValue = normalize(value);
  if (originalValue !== undefined && normalizedValue === normalize(originalValue)) return false;
  return existingValues.some(candidate => normalize(candidate) === normalizedValue);
}

export function validateRequired({ value, label }: { value: string; label: string }): string | null {
  return value.trim() ? null : `${label} is required.`;
}

export function validateResourceName({
  value,
  label,
  existingNames = [],
  originalName,
}: {
  value: string;
  label: string;
  existingNames?: readonly string[];
  originalName?: string;
}): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  if (!RESOURCE_NAME_PATTERN.test(trimmed)) {
    return `${label} must be 2–64 lowercase characters, start with a letter, and end with a letter or number.`;
  }
  if (isDuplicate({ value: trimmed, existingValues: existingNames, originalValue: originalName })) {
    return `${label} “${trimmed}” already exists.`;
  }
  return null;
}

export function validateHttpUrl({
  value,
  label,
  required = true,
}: {
  value: string;
  label: string;
  required?: boolean;
}): string | null {
  const trimmed = value.trim();
  if (!trimmed) return required ? `${label} is required.` : null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? null
      : `${label} must use http:// or https://.`;
  } catch {
    return `Enter a valid ${label.toLowerCase()}.`;
  }
}

export function validateHttpHeaderName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return HTTP_HEADER_NAME_PATTERN.test(trimmed)
    ? null
    : 'Header name may contain letters, numbers, hyphens, and standard HTTP header symbols only.';
}

export function validateGitRepositoryUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Repository URL is required.';
  if (!GIT_REPOSITORY_URL_PATTERN.test(trimmed) || containsParentTraversal(trimmed)) {
    return 'Enter an HTTPS GitHub or GitLab repository URL.';
  }
  return null;
}

export function validateGitPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Skill folder is required.';
  if (!GIT_PATH_PATTERN.test(trimmed)) {
    return 'Skill folder may contain letters, numbers, “.”, “_”, “-”, and “/” only.';
  }
  if (containsParentTraversal(trimmed) || trimmed.split('/').includes('.')) {
    return 'Skill folder must not contain “.” or “..” path segments.';
  }
  if (!trimmed.replace(/^\/+|\/+$/g, '')) return 'Skill folder must identify a directory.';
  return null;
}

export function validateGitRef(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Branch, tag, or commit is required.';
  if (!GIT_REF_PATTERN.test(trimmed)) {
    return 'Branch, tag, or commit may contain letters, numbers, “.”, “_”, “-”, and “/” only.';
  }
  if (containsParentTraversal(trimmed) || !trimmed.replace(/^\/+|\/+$/g, '')) {
    return 'Branch, tag, or commit must not contain “..” segments or only slashes.';
  }
  return null;
}

function validateInteger({ value, label, minimum }: { value: string; label: string; minimum: number }): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    return minimum === 0
      ? `${label} must be a whole number of 0 or more.`
      : `${label} must be a whole number greater than 0.`;
  }
  return null;
}

export function validatePositiveInteger({ value, label }: { value: string; label: string }): string | null {
  return validateInteger({ value, label, minimum: 1 });
}

export function validateNonNegativeInteger({ value, label }: { value: string; label: string }): string | null {
  return validateInteger({ value, label, minimum: 0 });
}

export function validateUniqueValue({
  value,
  values,
  label,
  caseSensitive = true,
}: {
  value: string;
  values: readonly string[];
  label: string;
  caseSensitive?: boolean;
}): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${label} is required.`;
  const normalizedValue = caseSensitive ? trimmed : trimmed.toLowerCase();
  const occurrences = values.filter(candidate => {
    const normalizedCandidate = caseSensitive ? candidate.trim() : candidate.trim().toLowerCase();
    return normalizedCandidate === normalizedValue;
  }).length;
  return occurrences > 1 ? `${label} “${trimmed}” must be unique.` : null;
}
