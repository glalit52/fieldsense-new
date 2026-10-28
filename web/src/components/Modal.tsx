import { useEffect, useRef, type ReactNode } from "react";

/** Accessible modal on the native <dialog>: focus trap, Escape to close, backdrop click to close. */
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon" onClick={onClose} aria-label="Close">✕</button>
      </header>
      {children}
    </dialog>
  );
}
