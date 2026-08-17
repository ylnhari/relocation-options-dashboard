import { readFile } from "node:fs/promises";
import {
  createSchemaValidatorSource,
  createV4SchemaValidatorSource,
  generatedValidatorUrl,
  generatedV4ValidatorUrl,
} from "./schema-validator-source.mjs";

const [expected, actual, expectedV4, actualV4] = await Promise.all([
  createSchemaValidatorSource(),
  readFile(generatedValidatorUrl, "utf8"),
  createV4SchemaValidatorSource(),
  readFile(generatedV4ValidatorUrl, "utf8"),
]);

if (actual !== expected || actualV4 !== expectedV4) {
  console.error("Generated schema validator is stale. Run: npm run generate:schema-validator");
  process.exitCode = 1;
}
