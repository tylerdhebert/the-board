import type { AppSettingsModels } from './api'

export default function SettingsPanel({
  settingsModels,
  settingsBackends,
  settingsError,
  settingsSaving,
  onClose,
  onSave,
  patchRole,
}: {
  settingsModels: AppSettingsModels | null
  settingsBackends: string[]
  settingsError: string | null
  settingsSaving: boolean
  onClose: () => void
  onSave: () => void
  patchRole: (
    role: keyof AppSettingsModels,
    patch: Partial<AppSettingsModels[keyof AppSettingsModels]>,
  ) => void
}) {
  return (
    <div
      className="settings-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="settings-panel chalk lit" role="dialog" aria-label="providers">
        <p className="eyebrow">providers</p>
        {settingsModels ? (
          (['teacher', 'gate', 'unlock', 'ingest'] as const).map((role) => (
            <div key={role} className="settings-row">
              <span className="role">{role}</span>
              <select
                value={settingsModels[role].backend}
                onChange={(e) => patchRole(role, { backend: e.target.value })}
              >
                {settingsBackends.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <input
                value={settingsModels[role].model}
                onChange={(e) => patchRole(role, { model: e.target.value })}
                spellCheck={false}
              />
            </div>
          ))
        ) : (
          !settingsError && <p className="settings-note">loading…</p>
        )}
        <p className="settings-note">
          applies to new turns · the chosen cli must be on your PATH
        </p>
        {settingsError && <p className="settings-error">{settingsError}</p>}
        <div className="settings-actions">
          <button type="button" className="settings-cancel" onClick={onClose}>
            cancel
          </button>
          <button
            type="button"
            className="settings-save"
            disabled={!settingsModels || settingsSaving}
            onClick={onSave}
          >
            {settingsSaving ? 'saving…' : 'save'}
          </button>
        </div>
      </div>
    </div>
  )
}
