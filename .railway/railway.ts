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
  });

  return project("field-sense", {
    variables: { managed: false },
    resources: [fieldSense],
  });
});
