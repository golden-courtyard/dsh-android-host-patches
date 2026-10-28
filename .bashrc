export SVDIR=$PREFIX/var/service

# Android: 硬链接不可用，用 rename 兜底（DSH 写会话日志要用）

# Android: 硬链接垫片 + sharp 替代（后端在 shims/sharp，vips 命令行）
export NODE_OPTIONS="--require=/data/data/com.termux/files/home/.dsh/android-fs-shim.cjs --require=/data/data/com.termux/files/home/shims/sharp-boot.cjs"
