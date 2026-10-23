import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="modal" aria-labelledby="modal-title" onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal-content">
        <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Fermer la fenêtre" onClick={onClose}><X size={20} /></button></div>
        {children}
      </div>
    </dialog>
  );
}
