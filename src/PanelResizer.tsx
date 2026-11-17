import type { RefObject } from "react";

/** Shared pointer and keyboard control for side-by-side workspace panels. */
export function PanelResizer({ containerRef, value, min, max, onChange, label, valueLabel }: {
  containerRef: RefObject<HTMLDivElement>;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  valueLabel: string;
}) {
  const update = (next: number) => onChange(Math.max(min, Math.min(max, next)));
  const resize = (clientX: number) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (bounds?.width) update(Math.round((clientX - bounds.left) / bounds.width * 100));
  };
  return <div className="panel-resizer" role="separator" tabIndex={0}
    aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max}
    aria-valuenow={value} aria-valuetext={`${value}% ${valueLabel}`}
    onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); resize(event.clientX); }}
    onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event.clientX); }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onKeyDown={event => {
      const change = event.key === "ArrowLeft" ? -2 : event.key === "ArrowRight" ? 2 : 0;
      if (change) { event.preventDefault(); update(value + change); }
      else if (event.key === "Home" || event.key === "End") { event.preventDefault(); update(event.key === "Home" ? min : max); }
    }}><span aria-hidden="true" /></div>;
}
