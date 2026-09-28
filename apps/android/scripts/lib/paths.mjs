// @ts-check
/** Where everything lives, from this package's folder. */

import path from "node:path";
import { fileURLToPath } from "node:url";

/** apps/android */
export const ANDROID_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/** The repository root. */
export const REPO_ROOT = path.resolve(ANDROID_DIR, "..", "..");
/** Bubblewrap's input: the committed source of truth for the Android project. */
export const TWA_MANIFEST = path.join(ANDROID_DIR, "twa-manifest.json");
/** The checksum Bubblewrap keeps of the manifest the project was generated from. */
export const MANIFEST_CHECKSUM = path.join(ANDROID_DIR, "manifest-checksum.txt");
/** Optional local settings (git-ignored). */
export const ENV_FILE = path.join(ANDROID_DIR, ".env");
/** Signing keys and their passwords (git-ignored). */
export const KEYS_DIR = path.join(ANDROID_DIR, ".keys");
/** Bubblewrap's config, the icon-localised manifest, Gradle's home (git-ignored). */
export const TOOLCHAIN_DIR = path.join(ANDROID_DIR, ".toolchain");
/** Signed APKs and AABs, and what the last build recorded (git-ignored). */
export const DIST_DIR = path.join(ANDROID_DIR, "dist");
/** The Polaris mark, the app icons and the shortcut icons. */
export const BRAND_ASSETS = path.join(REPO_ROOT, "packages", "brand", "assets");
/** The customer app's icon route, which serves the same files on the hosted site. */
export const APP_ICON_ROUTE = path.join(REPO_ROOT, "apps", "app", "src", "app", "icons", "[name]", "route.tsx");
