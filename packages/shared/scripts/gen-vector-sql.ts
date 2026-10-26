import { writeFileSync } from "node:fs";
import { buildGeoSql, buildPlaceholderSql, buildVectorSql, GEO_SQL_TEST_PATH, PLACEHOLDER_SQL_TEST_PATH, SQL_TEST_PATH } from "./vector-sql";

writeFileSync(SQL_TEST_PATH, buildVectorSql());
console.log(`✔ wrote ${SQL_TEST_PATH}`);
writeFileSync(PLACEHOLDER_SQL_TEST_PATH, buildPlaceholderSql());
console.log(`✔ wrote ${PLACEHOLDER_SQL_TEST_PATH}`);
writeFileSync(GEO_SQL_TEST_PATH, buildGeoSql());
console.log(`✔ wrote ${GEO_SQL_TEST_PATH}`);
