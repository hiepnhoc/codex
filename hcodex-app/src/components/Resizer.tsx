import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  /** Which edge of its (position: relative) parent the handle sits on. */
  edge: "left" | "right";
  /** Called with the pointer's x while dragging. */
  onDrag: (clientX: number) => void;
  /** Double-click: back to the default size. */
  onReset: () => void;
};

/** A thin drag handle on the edge of a panel. */
export function Resizer({ edge, onDrag, onReset }: Props) {
  const [dragging, setDragging] = useState(false);

  // No text selection and one cursor for the whole window while a panel is being dragged.
  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("resizing");
    return () => document.body.classList.remove("resizing");
  }, [dragging]);

  return (
    <div
      className={`resizer ${edge} ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize, double-click to reset"
      onPointerDown={(e) => {
        e.preventDefault();
        // Capture, so the drag keeps working over the editor and the terminal.
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => dragging && onDrag(e.clientX)}
      onPointerUp={(e) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
      }}
      onPointerCancel={() => setDragging(false)}
      onDoubleClick={onReset}
    />
  );
}

/** A panel width kept in localStorage. */
export function useStoredWidth(key: string, initial: number): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? saved : initial;
  });
  const latest = useRef(width);
  const set = useCallback(
    (w: number) => {
      const next = Math.round(w);
      if (next === latest.current) return;
      latest.current = next;
      setWidth(next);
      localStorage.setItem(key, String(next));
    },
    [key],
  );
  return [width, set];
}

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
