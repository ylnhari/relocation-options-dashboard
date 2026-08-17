import { writeFile } from "node:fs/promises";
import {
  createSchemaValidatorSource,
  createV4SchemaValidatorSource,
  generatedValidatorUrl,
  generatedV4ValidatorUrl,
} from "./schema-validator-source.mjs";

await Promise.all([
  writeFile(generatedValidatorUrl, await createSchemaValidatorSource(), "utf8"),
  writeFile(generatedV4ValidatorUrl, await createV4SchemaValidatorSource(), "utf8"),
]);
