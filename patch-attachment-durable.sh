#!/data/data/com.termux/files/usr/bin/bash
# Android 上附件写入失败：ensureDurableHome 会从 DSH_HOME 一路 fsync 到文件系统根，
# 而 /data/data 这一层对 Termux 不可读（system 所有），open 直接 EACCES。
#
# 改法：syncDirectory 里 open 失败且是 EACCES/EPERM 时跳过，不让整次写入失败。
# 语义上与其它几关一致 —— 无法担保的祖先目录就不担保，而不是整个操作失败。
#
# npm install -g 会覆盖，所以做成可重放的脚本。
set -u
D="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-attachment-local/lib/index.js"

[ -f "$D" ] || { echo "找不到 $D"; exit 1; }

if grep -q "android-durable-skip" "$D" 2>/dev/null; then
    echo "已经打过补丁，跳过"
    exit 0
fi

cp "$D" "$D.orig-$(date +%H%M%S)"

node - "$D" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8')

const from = '\tconst handle = await open(path, constants.O_RDONLY);'
const to = `\tlet handle;
\ttry {
\t\thandle = await open(path, constants.O_RDONLY);
\t} catch (error) {
\t\t/* android-durable-skip: /data/data 等祖先目录对应用不可读，无法 fsync，跳过 */
\t\tif (error && (error.code === "EACCES" || error.code === "EPERM")) return;
\t\tthrow error;
\t}`

const count = src.split(from).length - 1
if (count !== 1) {
    console.error(`  预期命中 1 次，实际 ${count} 次，放弃`)
    process.exit(1)
}
fs.writeFileSync(file, src.replace(from, to))
console.log('  已替换 1 处')
NODE

RC=$?
if [ "$RC" -ne 0 ]; then
    echo "补丁失败，退出码 $RC"
    exit 1
fi

echo "--- 语法检查 ---"
node --check "$D" && echo "  语法 OK"

echo "--- 补丁后的片段 ---"
grep -n -A16 "async function syncDirectory" "$D" | head -20
