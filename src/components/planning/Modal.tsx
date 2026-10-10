import { X } from "lucide-react"

export default function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
  width = 620,
}: {
  open: boolean
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  width?: number
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[#101828]/25 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-lg border border-[#D0D5DD] bg-white shadow-2xl"
        style={{ maxWidth: width }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-[#EAECF0] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[#172033]">{title}</h2>
            {description && (
              <p className="mt-1 text-[11px] leading-relaxed text-[#667085]">
                {description}
              </p>
            )}
          </div>
          <button type="button" className="icon-button dialog-close-button" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={24} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#EAECF0] bg-[#FCFCFD] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
