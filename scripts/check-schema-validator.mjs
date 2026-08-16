import { readFile } from "node:fs/promises";
import {
  createSchemaValidatorSource,
  generatedValidatorUrl,
} from "./schema-validator-source.mjs";

const [expected, actual] = await Promise.all([
  createSchemaValidatorSource(),
  readFile(generatedValidatorUrl, "utf8"),
]);

if (actual !== expected) {
  console.error("Generated schema validator is stale. Run: npm run generate:schema-validator");
  process.exitCode = 1;
}
