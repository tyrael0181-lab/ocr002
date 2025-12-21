$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\Slide Patcher.lnk")
$Shortcut.TargetPath = "$PSScriptRoot\launcher.vbs"
$Shortcut.WorkingDirectory = "$PSScriptRoot"
$Shortcut.Description = "Start Slide Patcher Development Server"
$Shortcut.IconLocation = "powershell.exe"
$Shortcut.Save()

Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  Desktop Shortcut Created!" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "You can now start the application by double-clicking 'Slide Patcher' on your desktop."
pause
