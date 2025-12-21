@echo off
if not exist node_modules (
    call npm install
)
call npm run dev -- --open
