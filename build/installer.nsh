; Дополнения к установщику LocalCord (NSIS, подключается electron-builder)

!macro customInstall
  ; Копия установщика: хост раздаёт её друзьям как обновление
  CreateDirectory "$INSTDIR\update-package"
  CopyFiles /SILENT "$EXEPATH" "$INSTDIR\update-package\LocalCord-Setup.exe"
  ; Ярлык быстрого удаления в меню «Пуск»
  CreateShortCut "$SMPROGRAMS\Удалить LocalCord.lnk" "$INSTDIR\Uninstall LocalCord.exe" "" "$INSTDIR\uninstallerIcon.ico" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Удалить LocalCord.lnk"
  ${ifNot} ${isUpdated}
    ; Правило брандмауэра (сработает, только если есть права администратора)
    nsExec::Exec 'netsh advfirewall firewall delete rule name=LocalCord'
    Pop $0
  ${endIf}
!macroend
