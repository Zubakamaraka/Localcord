@echo off
chcp 65001 >nul
rem Сборка установщика LocalCord (для разработчика). Нужен Node.js 20+.
cd /d "%~dp0"
if not exist node_modules (
  echo Устанавливаю зависимости...
  call npm install || goto :err
)
echo Собираю установщик...
call npm run dist || goto :err
echo.
echo Готово: папка dist
explorer dist
pause
exit /b 0
:err
echo Ошибка сборки.
pause
exit /b 1
