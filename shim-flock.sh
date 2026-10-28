#!/data/data/com.termux/files/usr/bin/bash
set -u
P="$PREFIX/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/node-addon-system/lib/flock.js"

if [ ! -f "$P" ]; then echo "找不到 $P"; exit 1; fi
if [ ! -f "$P.orig" ]; then cp "$P" "$P.orig"; echo "已备份为 flock.js.orig"; else echo "备份已存在"; fi

cat > "$P" <<'EOF'
/**
 * Android 替换版：原实现只认 linux / darwin，Android 上直接抛
 * "flock is not supported on android-arm64"。
 *
 * 本实现与 DSH 自己的 webworker 版等价（见
 * packages/experimental/webworker-runtime/src/node/external_packages/node-addon-system-flock.ts）：
 * JSONL 后端在进程内已经排除了其他写入者，内核锁是多余的，直接 resolve。
 *
 * ⚠️ 代价：跨进程的文件锁没了。同一工作区同时跑两个 dsh 实例会有写坏 JSONL 的风险。
 *    手机上单实例运行可接受。原生实现见同包 src/flock.c，可自行编译。
 */
export async function tryLockExclusive(_fd) {
    return
}
EOF

echo "=== 新内容 ==="
cat "$P"

echo ""
echo "=== 单测：不该再抛 ==="
node --input-type=module -e '
const m = await import("'"$P"'");
await m.tryLockExclusive(0);
console.log("  tryLockExclusive(0) -> resolved，没有抛");
' 2>&1

echo ""
echo "=== 用包的 exports 路径测（模拟真实调用）==="
cd "$PREFIX/lib/node_modules/@deepseek-ai/dsh"
node --input-type=module -e '
const m = await import("@deepseek-ai/node-addon-system/flock");
await m.tryLockExclusive(0);
console.log("  通过包名解析也 OK");
' 2>&1

echo "=== 完成 ==="
