import { writeFileSync } from "node:fs";
import { buildVectorSql, SQL_TEST_PATH } from "./vector-sql";

writeFileSync(SQL_TEST_PATH, buildVectorSql());
console.log(`✔ wrote ${SQL_TEST_PATH}`);
