#!/data/data/com.termux/files/usr/bin/bash
# 测 termux-sensor 在不同 -d 下的实际采样率
SENSOR='icm4x6xx Accelerometer Non-wakeup'
TMP="$HOME/.rate_tmp.json"

for d in 10 20 50 100; do
    for i in 1 2 3; do
        t0=$(date +%s%N)
        timeout 25 termux-sensor -s "$SENSOR" -d "$d" -n 60 > "$TMP" 2>&1
        t1=$(date +%s%N)
        ms=$(( (t1 - t0) / 1000000 ))
        n=$(grep -c values "$TMP" 2>/dev/null || echo 0)
        if [ "$ms" -gt 0 ] && [ "$n" -gt 0 ]; then
            hz=$(( n * 1000 / ms ))
            echo "d=$d|run=$i|ms=$ms|n=$n|hz=$hz"
        else
            echo "d=$d|run=$i|FAIL|ms=$ms|n=$n"
        fi
    done
done
rm -f "$TMP"
