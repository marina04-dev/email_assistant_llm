/**
 * drizzle.config.ts — instruction sheet for the drizzle-kit CLI.
 *
 * drizzle-kit is the command-line tool behind `npm run db:push`. Its job:
 * read the table definitions we write in TypeScript (in lib/db.ts) and
 * create/update the REAL tables inside the SQLite database file to match.
 * This file only parameterizes that tool — it contains no runtime logic
 * and is never imported by the application itself.
 */
import {defineConfig} from "drizzle-kit";

// `defineConfig` does nothing at runtime — it's a typed helper: it tells
// TypeScript which keys are legal in this object, so the editor can
// autocomplete them and flag typos in the config itself.
export default defineConfig({
    // Where our schema (table definitions) lives. A pointer, read only when
    // the CLI runs — the file doesn't need to exist until then.
    schema: "./lib/db.ts",

    // Which SQL dialect to generate. SQL databases differ in small syntax
    // details; drizzle-kit must know which flavor to emit.
    dialect: "sqlite",

    // For a client-server database this would be a network address plus
    // credentials. SQLite is a single local file, so the entire "credentials"
    // are just its path — relative to wherever the command is run (project root).
    dbCredentials: {
        url: "emails.db",
    },
});