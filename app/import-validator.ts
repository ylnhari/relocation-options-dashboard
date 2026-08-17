import generatedSchemaValidator from "./wayfinder-schema-validator.generated.mjs";
import generatedV4SchemaValidator from "./wayfinder-v4-schema-validator.generated.mjs";
import {
  parseWayfinderDocument,
  type DocumentValidationOptions,
  type DocumentResult,
  type ValidationIssue,
} from "./document";

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

type SchemaValidationError = {
  instancePath: string;
  keyword: string;
  message?: string;
  params?: {
    additionalProperty?: unknown;
    missingProperty?: unknown;
  };
};

type SchemaValidator = ((value: unknown) => boolean) & {
  errors?: SchemaValidationError[] | null;
};

const validateV5Schema = generatedSchemaValidator as SchemaValidator;
const validateV4Schema = generatedV4SchemaValidator as SchemaValidator;

function pathFromPointer(pointer: string) {
  if (!pointer) return "$";
  return pointer
    .slice(1)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce(
      (path, token) => (
        /^(0|[1-9]\d*)$/.test(token)
          ? `${path}[${token}]`
          : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)
            ? `${path}.${token}`
            : `${path}[${JSON.stringify(token)}]`
      ),
      "$",
    );
}

function schemaIssues(validator: SchemaValidator): ValidationIssue[] {
  return (validator.errors ?? []).map((error) => {
    let path = pathFromPointer(error.instancePath);
    if (
      (error.keyword === "required" || error.keyword === "additionalProperties")
      && typeof error.params?.missingProperty === "string"
    ) {
      path = `${path}.${error.params.missingProperty}`;
    }
    if (
      error.keyword === "additionalProperties"
      && typeof error.params?.additionalProperty === "string"
    ) {
      path = `${path}.${error.params.additionalProperty}`;
    }
    return {
      path,
      message: `Schema: ${error.message ?? `Failed ${error.keyword} validation.`}`,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function legacyInput(value: unknown) {
  if (Array.isArray(value)) return true;
  return isRecord(value)
    && Object.keys(value).every((key) => key === "scenarios")
    && Array.isArray(value.scenarios);
}

function validateGeneratedSchema(
  validator: SchemaValidator,
  value: unknown,
): ValidationIssue[] | null {
  return validator(value) ? null : schemaIssues(validator);
}

function canonicalV4Input(value: unknown) {
  return isRecord(value)
    && value.kind === "wayfinder-relocation-plan"
    && value.schemaVersion === 4;
}

/**
 * Validates data at every import boundary. v5 candidates are schema-checked
 * before semantic validation. A recognized v4 document is first checked
 * against the retained closed v4 schema, then migrated and v5 schema-checked.
 * The recognized legacy shape migrates first and its v5 result is schema-checked.
 */
export function validateWayfinderInput(
  value: unknown,
  options: DocumentValidationOptions = {},
): DocumentResult {
  if (canonicalV4Input(value)) {
    const v4Issues = validateGeneratedSchema(validateV4Schema, value);
    if (v4Issues) return { ok: false, issues: v4Issues };
    const result = parseWayfinderDocument(value, options);
    if (!result.ok) return result;
    const v5Issues = validateGeneratedSchema(validateV5Schema, result.document);
    return v5Issues ? { ok: false, issues: v5Issues } : result;
  }

  if (!legacyInput(value)) {
    const issues = validateGeneratedSchema(validateV5Schema, value);
    return issues ? { ok: false, issues } : parseWayfinderDocument(value, options);
  }

  const result = parseWayfinderDocument(value, options);
  if (!result.ok) return result;
  const issues = validateGeneratedSchema(validateV5Schema, result.document);
  return issues ? { ok: false, issues } : result;
}
