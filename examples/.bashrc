export SVDIR=$PREFIX/var/service

# Android: 硬链接不可用，用 rename 兜底（DSH 写会话日志要用）

# Android: 硬链接垫片（fs.link → rename）
# sharp 不走 NODE_OPTIONS 钩子：实测解码直接落在 node_modules/sharp，替换目录即可
export NODE_OPTIONS="--require=/data/data/com.termux/files/home/.dsh/android-fs-shim.cjs"
