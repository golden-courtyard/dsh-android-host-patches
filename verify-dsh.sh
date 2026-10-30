#!/data/data/com.termux/files/usr/bin/bash
# 端到端检查：dsh 能起、配置能组合、补丁没有把它弄坏。
# 用法：bash verify-dsh.sh [profile]        （默认 main）
#
# 判据是「配置能组合 + 没有未激活条目」，不依赖任何具体预设或插件。
set -u

PROFILE="${1:-main}"

echo "=== 1. 版本 ==="
dsh --version

echo
echo "=== 2. 组合配置（--dump-config 不登录、不进交互）==="
out=$(timeout 90 dsh --profile "$PROFILE" --dump-config 2>&1)
lines=$(printf '%s\n' "$out" | wc -l)
echo "  配置行数: $lines"

echo
echo "=== 3. 未激活 / 报错 ==="
hits=$(printf '%s\n' "$out" | grep -icE 'did not activate|pending|error' || true)
echo "  命中: $hits"
printf '%s\n' "$out" | grep -iE 'did not activate|pending|error' | head -6

echo
echo "=== 4. 判据 ==="
if [ "$lines" -gt 100 ] && [ "$hits" -eq 0 ]; then
    echo "  通过：配置能组合，没有未激活条目"
else
    echo "  不通过：行数不足说明组合失败；命中非零说明有插件没起来，看第 3 节"
    exit 1
fi
