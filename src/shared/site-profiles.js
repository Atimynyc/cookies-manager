import { parseSiteDataPackage } from "./site-data-package.js";
import { IMPORT_CONFLICT_STRATEGIES } from "./site-data-import.js";

const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VARIABLE_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function createSiteProfile({
  id = createProfileId(),
  name,
  description = "",
  tags = [],
  createdAt = new Date().toISOString(),
  updatedAt = createdAt,
  dataPackage,
  domainRules,
  defaultConflictStrategy = "overwrite",
  variables = []
} = {}) {
  const normalizedPackage = parseSiteDataPackage(dataPackage);
  const normalizedVariables = normalizeVariableCaptures(variables);
  const packageWithVariables = replaceCapturedValues(normalizedPackage, normalizedVariables);
  const sourceOrigin = normalizedPackage.source.origin;

  return normalizeSiteProfile({
    id,
    name,
    description,
    tags,
    createdAt,
    updatedAt,
    source: normalizedPackage.source,
    domainRules: domainRules || [sourceOrigin],
    defaultConflictStrategy,
    variables: normalizedVariables.map(({ capturedValue, ...variable }) => variable),
    dataPackage: packageWithVariables
  });
}

export function normalizeSiteProfile(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Profile must be an object.");
  }
  const name = String(value.name || "").trim();
  if (!name) {
    throw new TypeError("Profile name is required.");
  }
  const dataPackage = parseSiteDataPackage(value.dataPackage);
  const variables = normalizeStoredVariables(value.variables);
  const strategy = IMPORT_CONFLICT_STRATEGIES.has(value.defaultConflictStrategy)
    ? value.defaultConflictStrategy
    : "overwrite";

  return {
    id: String(value.id || createProfileId()),
    name,
    description: String(value.description || "").trim(),
    tags: normalizeTags(value.tags),
    createdAt: normalizeDate(value.createdAt),
    updatedAt: normalizeDate(value.updatedAt || value.createdAt),
    source: dataPackage.source,
    domainRules: normalizeDomainRules(value.domainRules, dataPackage.source.origin),
    defaultConflictStrategy: strategy,
    variables,
    dataPackage
  };
}

export function normalizeSiteProfiles(values, limit = 50) {
  if (!Array.isArray(values)) {
    return [];
  }
  const profiles = [];
  for (const value of values) {
    try {
      profiles.push(normalizeSiteProfile(value));
    } catch {
      // A malformed stored profile should not make the remaining profiles unavailable.
    }
    if (profiles.length >= limit) {
      break;
    }
  }
  return profiles;
}

export function resolveSiteProfileVariables(profileValue, inputs = {}) {
  const profile = normalizeSiteProfile(profileValue);
  const values = {};
  for (const variable of profile.variables) {
    if (Object.hasOwn(inputs, variable.name)) {
      values[variable.name] = String(inputs[variable.name]);
    } else if (!variable.promptOnApply) {
      values[variable.name] = variable.defaultValue;
    } else {
      throw new TypeError(`Enter a value for ${variable.name}.`);
    }
  }

  const resolved = replacePackageValues(profile.dataPackage, (value) => value.replace(
    VARIABLE_REFERENCE_PATTERN,
    (match, name) => Object.hasOwn(values, name) ? values[name] : match
  ));
  const unresolved = collectVariableReferences(resolved);
  if (unresolved.length > 0) {
    throw new TypeError(`Missing profile variables: ${unresolved.join(", ")}.`);
  }
  return parseSiteDataPackage(resolved);
}

export function parseVariableCaptures(text) {
  const variables = [];
  const names = new Set();
  for (const [index, rawLine] of String(text || "").split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new TypeError(`Variable line ${index + 1} must use name=value.`);
    }
    const rawName = line.slice(0, separator).trim();
    const promptOnApply = rawName.startsWith("!");
    const name = promptOnApply ? rawName.slice(1) : rawName;
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      throw new TypeError(`Variable name ${name || "on line " + (index + 1)} is invalid.`);
    }
    if (names.has(name)) {
      throw new TypeError(`Variable ${name} is duplicated.`);
    }
    const capturedValue = line.slice(separator + 1);
    if (!capturedValue) {
      throw new TypeError(`Variable ${name} needs a captured value.`);
    }
    names.add(name);
    variables.push({
      name,
      capturedValue,
      promptOnApply,
      ...(promptOnApply ? {} : { defaultValue: capturedValue })
    });
  }
  return variables;
}

export function duplicateSiteProfile(profileValue, timestamp = Date.now()) {
  const profile = normalizeSiteProfile(profileValue);
  const now = new Date(timestamp).toISOString();
  return normalizeSiteProfile({
    ...profile,
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${profile.name} copy`,
    createdAt: now,
    updatedAt: now
  });
}

export function renameSiteProfile(profileValue, name) {
  return normalizeSiteProfile({
    ...normalizeSiteProfile(profileValue),
    name,
    updatedAt: new Date().toISOString()
  });
}

function replaceCapturedValues(dataPackage, variables) {
  const replacements = [...variables]
    .sort((left, right) => right.capturedValue.length - left.capturedValue.length);
  return replacePackageValues(dataPackage, (value) => {
    let nextValue = value;
    for (const variable of replacements) {
      nextValue = nextValue.split(variable.capturedValue).join(`\${${variable.name}}`);
    }
    return nextValue;
  });
}

function replacePackageValues(dataPackage, replace) {
  const cloned = JSON.parse(JSON.stringify(dataPackage));
  for (const kind of ["cookies", "localStorage", "sessionStorage"]) {
    cloned.data[kind] = cloned.data[kind].map((item) => ({
      ...item,
      value: replace(item.value)
    }));
  }
  return cloned;
}

function collectVariableReferences(dataPackage) {
  const references = new Set();
  for (const kind of ["cookies", "localStorage", "sessionStorage"]) {
    for (const item of dataPackage.data[kind]) {
      for (const match of item.value.matchAll(VARIABLE_REFERENCE_PATTERN)) {
        references.add(match[1]);
      }
    }
  }
  return [...references];
}

function normalizeVariableCaptures(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value) => {
    const name = String(value?.name || "");
    const capturedValue = String(value?.capturedValue ?? "");
    if (!VARIABLE_NAME_PATTERN.test(name) || !capturedValue) {
      throw new TypeError("Profile variables require a valid name and captured value.");
    }
    const promptOnApply = Boolean(value.promptOnApply);
    return {
      name,
      capturedValue,
      promptOnApply,
      ...(promptOnApply ? {} : { defaultValue: String(value.defaultValue ?? capturedValue) })
    };
  });
}

function normalizeStoredVariables(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const names = new Set();
  return values.map((value) => {
    const name = String(value?.name || "");
    if (!VARIABLE_NAME_PATTERN.test(name) || names.has(name)) {
      throw new TypeError("Profile variable names must be valid and unique.");
    }
    names.add(name);
    const promptOnApply = Boolean(value.promptOnApply);
    return {
      name,
      promptOnApply,
      ...(promptOnApply ? {} : { defaultValue: String(value.defaultValue ?? "") })
    };
  });
}

function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return [...new Set(values.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 12);
}

function normalizeDomainRules(rules, sourceOrigin) {
  const values = Array.isArray(rules) ? rules : [];
  const normalized = values.map((rule) => String(rule || "").trim()).filter(Boolean);
  return normalized.length > 0 ? [...new Set(normalized)] : [sourceOrigin];
}

function normalizeDate(value) {
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function createProfileId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
