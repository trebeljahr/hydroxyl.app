/**
 * The release the e2e build claims to be. playwright.config.ts bakes it into
 * the web export as NEXT_PUBLIC_BUILD_COMMIT, so `ReleaseLifetime` runs as it
 * does in production; a full lowercase hex SHA, as it requires.
 */
export const E2E_COMMIT = "e2e".padEnd(40, "0");
