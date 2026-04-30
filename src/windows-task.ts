export const WINDOWS_TASK_FOLDER_NAME = "Jin";
export const WINDOWS_TASK_PATH = "\\Jin\\";
export const WINDOWS_TASK_NAME_PREFIX = "jin-agent-";

export function windowsTaskNameForSid(sid: string): string {
  return `${WINDOWS_TASK_NAME_PREFIX}${sid.trim()}`;
}

export function windowsTaskReferenceForDocs(): string {
  return `${WINDOWS_TASK_PATH}${WINDOWS_TASK_NAME_PREFIX}<sid>`;
}

export function windowsTaskIdentityPowerShellLines(): string[] {
  return [
    `$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value`,
    `$taskPath = '${WINDOWS_TASK_PATH}'`,
    `$taskName = '${WINDOWS_TASK_NAME_PREFIX}' + $sid`,
  ];
}
