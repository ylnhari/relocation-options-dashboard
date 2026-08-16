import { writeFile } from "node:fs/promises";
import {
  createSchemaValidatorSource,
  generatedValidatorUrl,
} from "./schema-validator-source.mjs";

await writeFile(generatedValidatorUrl, await createSchemaValidatorSource(), "utf8");
