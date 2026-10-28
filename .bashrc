export SVDIR=$PREFIX/var/service

# Android: 硬链接不可用，用 rename 兜底（DSH 写会话日志要用）
export NODE_OPTIONS="--require=/data/data/com.termux/files/home/.dsh/android-fs-shim.cjs"
