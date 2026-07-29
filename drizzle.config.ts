import {defineConfig} from "drizzle-kit";

export default defineConfig({
    schema: "./lib/db.ts",

    dialect: "sqlite",

    dbCredentials: {
        url: "emails.db",
    },
});