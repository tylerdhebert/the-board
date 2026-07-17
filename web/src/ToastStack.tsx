export type Toast = { id: number; text: string; tone: 'done' | 'error' | 'canceled' }

export default function ToastStack({ toasts, onDismiss }: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast chalk ${toast.tone}`} onClick={() => onDismiss(toast.id)}>
          {toast.text}
        </button>
      ))}
    </div>
  )
}
