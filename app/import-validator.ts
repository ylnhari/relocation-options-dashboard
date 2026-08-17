import generatedSchemaValidator from "./wayfinder-schema-validator.generated.mjs";
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

const validateSchema = generatedSchemaValidator as SchemaValidator;

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

function schemaIssues(): ValidationIssue[] {
  return (validateSchema.errors ?? []).map((error) => {
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

function validateV4Schema(value: unknown): ValidationIssue[] | null {
  return validateSchema(value) ? null : schemaIssues();
}

/**
 * Validates data at every import boundary. v4 candidates are schema-checked
 * before semantic validation; the recognized legacy shape migrates first and
 * the resulting v4 document is schema-checked before it is accepted.
 */
export function validateWayfinderInput(
  value: unknown,
  options: DocumentValidationOptions = {},
): DocumentResult {
  if (!legacyInput(value)) {
    const issues = validateV4Schema(value);
    return issues ? { ok: false, issues } : parseWayfinderDocument(value, options);
  }

  const result = parseWayfinderDocument(value, options);
  if (!result.ok) return result;
  const issues = validateV4Schema(result.document);
  return issues ? { ok: false, issues } : result;
}
