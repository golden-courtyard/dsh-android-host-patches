#!/data/data/com.termux/files/usr/bin/bash
set -u

echo "=== 1. 现有 profile 的 bundles ==="
cat "$HOME/.dsh/profiles/main/package.json"

echo ""
echo "=== 2. dsh 支持哪些默认模板（试错法）==="
for name in web desktop headless sdk-minimal acp; do
    rm -rf "$HOME/.dsh/profiles/probe-$name"
    out=$(timeout 40 dsh --from-default-profile "$name" --profile "probe-$name" --dump-config 2>&1 | head -3)
    if echo "$out" | grep -qiE 'error|does not exist|cannot'; then
        echo "  $name : 不可用"
    else
        echo "  $name : OK"
    fi
    rm -rf "$HOME/.dsh/profiles/probe-$name"
done

echo ""
echo "=== 3. 从 web 模板造一个临时 profile，看它的 bundles ==="
rm -rf "$HOME/.dsh/profiles/probe2"
timeout 60 dsh --from-default-profile web --profile probe2 --dump-config > /dev/null 2>&1
if [ -f "$HOME/.dsh/profiles/probe2/package.json" ]; then
    cat "$HOME/.dsh/profiles/probe2/package.json"
else
    echo "  没生成"
fi

echo "=== 完成 ==="
