@echo off
chcp 65001 >nul
cd /d "%~dp0"
set MOCKUP=.\mockup
set PROJECT=genba

node bin\ichiki.js lint %MOCKUP%
if errorlevel 1 (
  echo.
  echo NG: モックの書き方に直すところがあります。上の一覧を技術担当に渡してください
  pause
  exit /b 1
)

node bin\ichiki.js scan %MOCKUP% .\out --project %PROJECT%
echo.
if exist out\acf-map.yaml (if exist out\CLAUDE.md (echo OK: out に acf-map.yaml と CLAUDE.md ができました) else (echo NG: ファイルができていません。技術担当に連絡してください)) else (echo NG: ファイルができていません。技術担当に連絡してください)
pause
