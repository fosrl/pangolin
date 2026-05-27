import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/**/*.test.ts"],
        exclude: ["node_modules", "dist", ".next"],
        testTimeout: 10000,
        coverage: {
            provider: "v8",
            include: [
                "server/lib/**/*.ts",
                "server/auth/**/*.ts",
                "server/routers/**/*.ts"
            ],
            exclude: [
                "**/*.test.ts",
                "**/index.ts",
                "server/db/**",
                "server/emails/**",
                "server/private/**"
            ]
        }
    },
    resolve: {
        alias: {
            "@server": path.resolve(__dirname, "server"),
            "@app": path.resolve(__dirname, "src"),
            "@test": path.resolve(__dirname, "test"),
            "@/": path.resolve(__dirname, "src/"),
            "#dynamic": path.resolve(__dirname, "server"),
            "#open": path.resolve(__dirname, "server"),
            "#closed": path.resolve(__dirname, "server/private"),
            "#private": path.resolve(__dirname, "server/private")
        }
    }
});
