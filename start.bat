@echo off
title Mille Bornes Online Server
cd /d "%~dp0"
echo =====================================
echo   Mille Bornes Online - Serveur
echo =====================================
echo.
echo Demarrage du serveur sur http://localhost:3000
echo.
echo - Ouvre http://localhost:3000 dans ton navigateur
echo - Partage l'URL avec tes amis (ou utilise ngrok)
echo - Appuie sur Ctrl+C pour arreter
echo =====================================
echo.
node server/index.js
pause
