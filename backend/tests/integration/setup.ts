import { testDatabaseUrl } from "./test-db.ts";

process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = "test";
