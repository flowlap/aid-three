#!/usr/bin/env node
// git push 시 pre-push 훅(.githooks/pre-push)에서 호출되어 package.json의
// 버전을 minor 자리 기준 0.1씩 올린다 (예: 0.3.0 -> 0.4.0).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const [major, minor] = pkg.version.split(".").map(Number);
pkg.version = `${major}.${minor + 1}.0`;

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`[bump-version] 버전을 ${pkg.version}(으)로 올렸습니다.`);
