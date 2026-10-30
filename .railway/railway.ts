import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "field-sense";
export default defineRailway(() => {
  const fieldSense = service("field-sense", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: { "iad": 1 },
    // Carried over from railway.json, which the migration tool doesn't translate.
    deploy: { restartPolicyType: "ON_FAILURE", restartPolicyMaxRetries: 10, drainingSeconds: 15, sleepApplication: false },
  });

  // Variables stay in the Railway dashboard (secrets never live in this file). The CLI reads `variables`, but the
  // SDK's ProjectDefinition type (railway 3.16) doesn't declare it yet, so it's passed through a spread to type-check.
  const unmanagedVariables = { variables: { managed: false } };
  return project("field-sense", {
    ...unmanagedVariables,
    resources: [fieldSense],
  });
});
