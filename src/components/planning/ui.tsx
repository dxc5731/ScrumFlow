import { useEffect, useState } from "react";
import { CheckCircle2, Info, RotateCcw, X } from "lucide-react";
import { useProjectStore } from "../../store/projectStore";

export type ToastTone = "success" | "info" | "error";

export function notify(message: string, tone: ToastTone = "success", undo = false) {
  window.dispatchEvent(new CustomEvent("scrumflow:toast", { detail: { message, tone, undo } }));
}

export function ToastHost() {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; undo: boolean } | null>(null);
  const undoLastChange = useProjectStore((state) => state.undoLastChange);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; tone: ToastTone; undo: boolean }>).detail;
      setToast(detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 4200);
    };
    window.addEventListener("scrumflow:toast", handler);
    return () => {
      window.removeEventListener("scrumflow:toast", handler);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!toast) return null;
  const color = toast.tone === "error" ? "#B42318" : toast.tone === "info" ? "#175CD3" : "#067647";
  const bg = toast.tone === "error" ? "#FEF3F2" : toast.tone === "info" ? "#EFF8FF" : "#ECFDF3";

  return (
    <div className="fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-3 rounded-lg border px-4 py-2.5 shadow-lg"
      style={{ background: bg, borderColor: `${color}30`, color }}>
      {toast.tone === "success" ? <CheckCircle2 size={15} /> : <Info size={15} />}
      <span className="text-xs font-medium">{toast.message}</span>
      {toast.undo && (
        <button className="flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold hover:bg-white/70"
          onClick={() => {
            const result = undoLastChange();
            notify(result.message, result.ok ? "success" : "error");
            setToast(null);
          }}>
          <RotateCcw size={12} /> 撤销
        </button>
      )}
      <button className="rounded p-1 hover:bg-white/70" onClick={() => setToast(null)} aria-label="关闭提示">
        <X size={13} />
      </button>
    </div>
  );
}

export function MemberAvatar({ memberId, size = 22 }: { memberId: string; size?: number }) {
  const member = useProjectStore((state) => state.members[memberId]);
  if (!member) return <span className="inline-block rounded-full bg-gray-200" style={{ width: size, height: size }} />;
  return (
    <span className="inline-flex flex-shrink-0 items-center justify-center rounded-full font-semibold text-white"
      title={`${member.name} · ${member.role}`}
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.34), background: member.color }}>
      {member.initials}
    </span>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-[10px] font-semibold uppercase text-[#98A2B3]">{children}</div>;
}
