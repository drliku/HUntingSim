@echo off
cd /d "%~dp0"
echo Starting Wildlife Hunting Simulator on http://localhost:8080
start "" http://localhost:8080
echo For PvP, friends on your Wi-Fi open the address printed below.
node server.js 8080
