; MD Viewer インストーラー定義(Inno Setup 6)
; ビルド: build/build-portable.mjs の実行後、dist/portable/ の内容をそのまま取り込む。
; 実行: "%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" installer\setup.iss
;   （バージョンは /DAppVersion=1.2.3 で上書き可能。省略時は既定値を使用）

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "MD Viewer"
#define AppExeName "mdv.exe"
#define PortableDir "..\dist\portable"

[Setup]
AppId={{8F2B7B6E-2B7B-4B0E-9B7D-2C2B2B7B6E2B}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=suguruma
AppPublisherURL=https://github.com/suguruma/md-viewer
DefaultDirName={autopf}\MDViewer
DefaultGroupName=MD Viewer
DisableProgramGroupPage=yes
; 管理者権限を要求しない(ユーザーごとのProgram Filesへインストール)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=md-viewer-setup-win-x64-v{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#AppExeName}
; 未署名配布のため、SmartScreen 警告が出る旨をREADMEおよびGitHub Releaseノートで案内する

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "addtopath"; Description: "PATH に追加してターミナルから mdv コマンドを使えるようにする / Add to PATH so 'mdv' works from any terminal"; Flags: unchecked

[Files]
Source: "{#PortableDir}\mdv.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PortableDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PortableDir}\はじめにお読みください.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\MD Viewer (サンプルを開く)"; Filename: "{app}\{#AppExeName}"; Parameters: """{app}\app\sample"""; WorkingDir: "{app}"
Name: "{group}\はじめにお読みください"; Filename: "{app}\はじめにお読みください.txt"
Name: "{group}\{cm:UninstallProgram,MD Viewer}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\MD Viewer"; Filename: "{app}\{#AppExeName}"; Parameters: """{app}\app\sample"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\はじめにお読みください.txt"; Description: "はじめにお読みくださいを表示する"; Flags: postinstall shellexec skipifsilent unchecked
Filename: "{app}\{#AppExeName}"; Parameters: """{app}\app\sample"""; Description: "{cm:LaunchProgram,MD Viewer (sample)}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
const
  EnvKey = 'Environment';

procedure EnvAddPath(Dir: string);
var
  Paths: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvKey, 'Path', Paths) then
    Paths := '';
  // 既に含まれていれば何もしない
  if Pos(';' + Dir + ';', ';' + Paths + ';') > 0 then
    exit;
  if (Paths <> '') and (Paths[Length(Paths)] <> ';') then
    Paths := Paths + ';';
  Paths := Paths + Dir;
  RegWriteExpandStringValue(HKEY_CURRENT_USER, EnvKey, 'Path', Paths);
end;

procedure EnvRemovePath(Dir: string);
var
  Paths: string;
  P: Integer;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, EnvKey, 'Path', Paths) then
    exit;
  P := Pos(';' + Dir + ';', ';' + Paths + ';');
  if P > 0 then
    Delete(Paths, P - 1, Length(Dir) + 1)
  else
  begin
    P := Pos(Dir, Paths);
    if P > 0 then Delete(Paths, P, Length(Dir));
  end;
  RegWriteExpandStringValue(HKEY_CURRENT_USER, EnvKey, 'Path', Paths);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and WizardIsTaskSelected('addtopath') then
    EnvAddPath(ExpandConstant('{app}'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    EnvRemovePath(ExpandConstant('{app}'));
end;
