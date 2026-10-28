#!/data/data/com.termux/files/usr/bin/bash
set -u
echo "=== A. --dump-config 里有没有预设 ==="
out=$(timeout 90 dsh --profile main --dump-config 2>&1)
echo "$out" | wc -l
echo "$out" | grep -cE '华|爻光' || true
echo "$out" | grep -E "preset-delivery|preset-sec-assessment|华|爻光" | head -6

echo "=== B. 有没有 error / did not activate ==="
echo "$out" | grep -iE 'error|did not activate|pending' | head -6

echo "=== C. 尝试真正启动（3 秒后杀掉）==="
timeout 15 dsh --profile main 2>&1 | head -25

echo "=== 完成 ==="
