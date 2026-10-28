#!/data/data/com.termux/files/usr/bin/bash
set -u
P="$HOME/.dsh/profiles/main/package.json"
cp "$P" "$P.bak-$(date +%H%M%S)"

node - "$P" <<'NODE'
const fs = require('node:fs');
const p = process.argv[2];
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const want = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-preset-delivery', 'dsh-preset-sec-assessment'];
j.dsh = j.dsh || {};
j.dsh.profile = j.dsh.profile || {};
j.dsh.profile.bundles = want;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
console.log('已写入，bundles =', JSON.stringify(want));
NODE

echo "=== 验证 ==="
cat "$P"

echo ""
echo "=== dump-config 看预设能不能激活 ==="
out=$(timeout 90 dsh --profile main --dump-config 2>&1)
echo "$out" | wc -l
echo "$out" | grep -cE '华|爻光' || true

echo "=== 真正启动（15 秒后终止）==="
timeout 15 dsh --profile main 2>&1 | head -20

echo "=== 完成 ==="
