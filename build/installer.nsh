; Actual uninstall removes only this application's startup entry; upgrades preserve it.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dsh-pet-desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "dsh-pet-desktop"
  ${endIf}
!macroend
