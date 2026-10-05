; Дополнения к установщику LocalCord (NSIS, подключается electron-builder)

!ifndef BUILD_UNINSTALLER
  ; ----- тексты мастера установки -----
  !define MUI_WELCOMEPAGE_TITLE "Установка LocalCord ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "Голос, чат, файлы и демонстрация экрана для своей компании — в локальной сети или через Radmin VPN.$\r$\n$\r$\nПрава администратора не нужны. Если LocalCord уже установлен, он обновится, а профиль, настройки и история сохранятся.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
  !define MUI_FINISHPAGE_TITLE "LocalCord установлен"
  !define MUI_FINISHPAGE_TEXT "Ярлыки появились на рабочем столе и в меню «Пуск».$\r$\n$\r$\nВ первый раз введите имя, а затем создайте сервер или подключитесь к другу.$\r$\n$\r$\nЕсли Windows спросит про доступ к сети — нажмите «Разрешить»."
  !define MUI_FINISHPAGE_RUN_TEXT "Запустить LocalCord"
  !define MUI_FINISHPAGE_LINK "Страница LocalCord"
  !define MUI_FINISHPAGE_LINK_LOCATION "https://zubakamaraka.github.io/Localcord/"
!else
  !define MUI_FINISHPAGE_TITLE "LocalCord удалён"
  !define MUI_FINISHPAGE_TEXT "Программа удалена с компьютера. Будем рады видеть вас снова!"
!endif

; Приветственная страница с картинкой слева
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

; Установка только для текущего пользователя — без вопроса «для меня / для всех»
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
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
