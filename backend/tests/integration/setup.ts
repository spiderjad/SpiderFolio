import { testDatabaseUrl } from "./test-db.ts";

process.env.DATABASE_URL = testDatabaseUrl();
process.env.NODE_ENV = "test";
// Low, so the login limit per IP is reached in a test (in production it's 500 by default).
process.env.LOGIN_LIMIT_PER_IP = "50";
