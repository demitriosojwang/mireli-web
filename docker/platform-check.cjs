// Diagnostic only: reports the OpenSSL platform Prisma detects inside the
// runtime image. Run with:
//   docker run --rm -v "%cd%/docker/platform-check.cjs:/check.cjs:ro" --entrypoint node mireli-web:latest /check.cjs
const { getPlatform } = require("/opt/prisma-cli/node_modules/@prisma/get-platform");
getPlatform()
  .then((platform) => console.log("detected platform:", platform))
  .catch((error) => console.error("detection failed:", error && error.message));
