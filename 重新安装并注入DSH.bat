@echo off
chcp 65001 >nul
echo [DX Zcode] 正在重新打包并注入 DSH Profile...
cd /d "%~dp0"
node bin\install-tgz.mjs
echo.
echo [DX Zcode] 处理完成，请重启 DSH Desktop！
pause
