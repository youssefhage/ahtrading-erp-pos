import adminPackage from "../package.json";

export const ADMIN_APP_VERSION =
  String(process.env.NEXT_PUBLIC_ADMIN_APP_VERSION || adminPackage.version || "").trim() || "dev";
