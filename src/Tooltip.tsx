import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** One shared tooltip for controls and other elements with data-tooltip. */
export function Tooltip() {
  const [active, setActive] = useState<{ element: HTMLElement; text: string } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (event: Event) => {
      if (event instanceof PointerEvent && event.pointerType === "touch") return;
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tooltip]") : null;
      const text = element?.getAttribute("data-tooltip");
      if (element && text) setActive({ element, text });
    };
    const hide = (event: Event) => {
      const next = event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;
      setActive(current => current && next instanceof Node && current.element.contains(next) ? current : null);
    };
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setActive(null); };
    const clear = () => setActive(null);
    document.addEventListener("pointerover", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusin", show);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", dismiss);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusin", show);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", dismiss);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const element = active.element;
    const observer = new MutationObserver(() => {
      const text = element.getAttribute("data-tooltip");
      setActive(current => current?.element !== element ? current : text ? { element, text } : null);
    });
    observer.observe(element, { attributes: true, attributeFilter: ["data-tooltip"] });
    return () => observer.disconnect();
  }, [active?.element]);
  useLayoutEffect(() => {
    if (!active || !tooltip.current) return;
    const oldDescription = active.element.getAttribute("aria-describedby");
    active.element.setAttribute("aria-describedby", [oldDescription, "app-tooltip"].filter(Boolean).join(" "));
    const anchor = active.element.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, anchor.left + (anchor.width - box.width) / 2));
    const top = anchor.top >= box.height + 10 ? anchor.top - box.height - 8 : Math.min(window.innerHeight - box.height - 8, anchor.bottom + 8);
    setPosition({ left, top: Math.max(8, top) });
    return () => {
      if (oldDescription === null) active.element.removeAttribute("aria-describedby");
      else active.element.setAttribute("aria-describedby", oldDescription);
    };
  }, [active]);
  return active ? createPortal(<div id="app-tooltip" ref={tooltip} className="app-tooltip" role="tooltip" style={{ left: position.left, top: position.top }}>{active.text}</div>, document.fullscreenElement ?? document.body) : null;
}
