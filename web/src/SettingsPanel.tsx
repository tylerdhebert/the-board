import { useState } from 'react'
import { putLeetCodeSettings, type AppSettingsModels } from './api'

export default function SettingsPanel({
  settingsModels,
  settingsBackends,
  settingsLeetcode,
  settingsError,
  settingsSaving,
  onClose,
  onSave,
  patchRole,
  onLeetcodeChanged,
}: {
  settingsModels: AppSettingsModels | null
  settingsBackends: string[]
  settingsLeetcode: boolean | null
  settingsError: string | null
  settingsSaving: boolean
  onClose: () => void
  onSave: () => void
  patchRole: (
    role: keyof AppSettingsModels,
    patch: Partial<AppSettingsModels[keyof AppSettingsModels]>,
  ) => void
  onLeetcodeChanged: (signedIn: boolean) => void
}) {
  const inDesktop = typeof window !== 'undefined' && Boolean(window.tutorDesktop)
  const [sessionCookie, setSessionCookie] = useState('')
  const [csrfToken, setCsrfToken] = useState('')
  const [leetcodeBusy, setLeetcodeBusy] = useState(false)
  const [leetcodeError, setLeetcodeError] = useState<string | null>(null)

  async function signIn() {
    setLeetcodeBusy(true)
    setLeetcodeError(null)
    try {
      if (inDesktop) {
        const result = await window.tutorDesktop!.lcLogin()
        onLeetcodeChanged(result.signedIn)
      } else {
        await putLeetCodeSettings({ session: sessionCookie, csrf: csrfToken })
        setSessionCookie('')
        setCsrfToken('')
        onLeetcodeChanged(true)
      }
    } catch (err) {
      setLeetcodeError(err instanceof Error ? err.message : String(err))
    } finally {
      setLeetcodeBusy(false)
    }
  }

  async function signOut() {
    setLeetcodeBusy(true)
    setLeetcodeError(null)
    try {
      if (inDesktop) await window.tutorDesktop!.lcLogout()
      else await putLeetCodeSettings({ clear: true })
      onLeetcodeChanged(false)
    } catch (err) {
      setLeetcodeError(err instanceof Error ? err.message : String(err))
    } finally {
      setLeetcodeBusy(false)
    }
  }

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
        <div className="settings-divider" />
        <div className="settings-provider-head">
          <span className="role">leetcode</span>
          <span className="settings-status">
            {settingsLeetcode === null ? 'loading…' : settingsLeetcode ? 'signed in' : 'not signed in'}
          </span>
        </div>
        {settingsLeetcode ? (
          <button type="button" className="settings-link" onClick={() => void signOut()} disabled={leetcodeBusy}>
            {leetcodeBusy ? 'signing out…' : 'sign out'}
          </button>
        ) : inDesktop ? (
          <button type="button" className="settings-link" onClick={() => void signIn()} disabled={leetcodeBusy}>
            {leetcodeBusy ? 'opening…' : 'sign in'}
          </button>
        ) : (
          <div className="settings-cookie-form">
            <input
              value={sessionCookie}
              onChange={(e) => setSessionCookie(e.target.value)}
              placeholder="session cookie"
              spellCheck={false}
              type="password"
            />
            <input
              value={csrfToken}
              onChange={(e) => setCsrfToken(e.target.value)}
              placeholder="csrf token"
              spellCheck={false}
              type="password"
            />
            <button
              type="button"
              className="settings-link"
              onClick={() => void signIn()}
              disabled={leetcodeBusy || !sessionCookie.trim() || !csrfToken.trim()}
            >
              {leetcodeBusy ? 'saving…' : 'sign in'}
            </button>
          </div>
        )}
        {leetcodeError && <p className="settings-error">{leetcodeError}</p>}
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
