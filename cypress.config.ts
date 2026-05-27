import { defineConfig } from "cypress";

export default defineConfig({
    e2e: {
        baseUrl: "http://localhost:3000",
        supportFile: "cypress/support/e2e.ts",
        specPattern: "cypress/e2e/**/*.cy.ts",
        viewportWidth: 1280,
        viewportHeight: 720,
        defaultCommandTimeout: 10000,
        setupNodeEvents(_on, _config) {
            // implement node event listeners here
        }
    }
});
