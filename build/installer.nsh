; Дополнения к установщику LocalCord (NSIS, подключается electron-builder)
; Установщик двуязычный: русский на русской Windows, английский — на всех остальных.

; ----- тёмное оформление в стиле приложения -----
!define MUI_BGCOLOR "1E1F22"
!define MUI_TEXTCOLOR "F2F3F5"

; ----- тексты: 1049 — русский, 1033 — английский -----
LangString lcWelcomeTitle 1049 "Установка LocalCord ${VERSION}"
LangString lcWelcomeTitle 1033 "LocalCord ${VERSION} Setup"
LangString lcWelcomeText 1049 "Голос, чат, файлы и демонстрация экрана для своей компании — в локальной сети или через Radmin VPN.$\r$\n$\r$\nПрава администратора не нужны. Если LocalCord уже установлен, он обновится, а профиль, настройки и история сохранятся.$\r$\n$\r$\nНажмите «Далее», чтобы продолжить."
LangString lcWelcomeText 1033 "Voice, chat, files and screen sharing for your own group — on a local network or over Radmin VPN.$\r$\n$\r$\nNo administrator rights are needed. If LocalCord is already installed, it will be updated; your profile, settings and history are kept.$\r$\n$\r$\nClick Next to continue."
LangString lcFinishTitle 1049 "LocalCord установлен"
LangString lcFinishTitle 1033 "LocalCord is installed"
LangString lcFinishText 1049 "Ярлыки появились на рабочем столе и в меню «Пуск».$\r$\n$\r$\nВ первый раз введите имя, а затем создайте сервер или подключитесь к другу."
LangString lcFinishText 1033 "Shortcuts were added to the desktop and the Start menu.$\r$\n$\r$\nOn first launch enter your name, then create a server or join a friend."
LangString lcRun 1049 "Запустить LocalCord"
LangString lcRun 1033 "Launch LocalCord"
LangString lcSite 1049 "Страница LocalCord"
LangString lcSite 1033 "LocalCord website"
LangString lcSiteUrl 1049 "https://zubakamaraka.github.io/Localcord/"
LangString lcSiteUrl 1033 "https://zubakamaraka.github.io/Localcord/en/"
LangString lcRemovedTitle 1049 "LocalCord удалён"
LangString lcRemovedTitle 1033 "LocalCord has been removed"
LangString lcRemovedText 1049 "Программа удалена с компьютера. Будем рады видеть вас снова!"
LangString lcRemovedText 1033 "The app has been removed from this computer. We will be glad to see you again!"
LangString lcUninstallLink 1049 "Удалить LocalCord"
LangString lcUninstallLink 1033 "Uninstall LocalCord"

!ifndef BUILD_UNINSTALLER
  !define MUI_WELCOMEPAGE_TITLE "$(lcWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(lcWelcomeText)"
  !define MUI_FINISHPAGE_TITLE "$(lcFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(lcFinishText)"
  !define MUI_FINISHPAGE_RUN_TEXT "$(lcRun)"
  !define MUI_FINISHPAGE_LINK "$(lcSite)"
  !define MUI_FINISHPAGE_LINK_LOCATION "$(lcSiteUrl)"
!else
  !define MUI_FINISHPAGE_TITLE "$(lcRemovedTitle)"
  !define MUI_FINISHPAGE_TEXT "$(lcRemovedText)"
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
  ; Ярлык быстрого удаления в меню «Пуск» (старое название убираем, если язык системы сменился)
  Delete "$SMPROGRAMS\Удалить LocalCord.lnk"
  Delete "$SMPROGRAMS\Uninstall LocalCord.lnk"
  CreateShortCut "$SMPROGRAMS\$(lcUninstallLink).lnk" "$INSTDIR\Uninstall LocalCord.exe" "" "$INSTDIR\uninstallerIcon.ico" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Удалить LocalCord.lnk"
  Delete "$SMPROGRAMS\Uninstall LocalCord.lnk"
  ${ifNot} ${isUpdated}
    ; Правило брандмауэра (сработает, только если есть права администратора)
    nsExec::Exec 'netsh advfirewall firewall delete rule name=LocalCord'
    Pop $0
  ${endIf}
!macroend
