export const SETTINGS_RESET_CONFIRMATION_PHRASE = 'RESET'

export interface SettingsPrivacyState {
  analytics: false
  automaticUpdateChecks: false
  crashReporting: false
  remoteConfig: false
  runtimeFontCdnCalls: false
  telemetry: false
}

export interface SettingsSnapshot {
  appVersion: string
  privacy: SettingsPrivacyState
  workerCommand: string
}

export interface ResetLocalAppDataInput {
  confirmationPhrase: string
}
