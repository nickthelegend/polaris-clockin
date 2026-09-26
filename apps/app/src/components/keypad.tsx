"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./icon";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "000", "0", "back"] as const;
type Key = (typeof KEYS)[number];

/** Whole dollars, up to $999,999: what the reference keypad (with its 000 key) can type. */
const MAX_DIGITS = 6;

export function applyKey(value: string, key: Key): string {
  if (key === "back") return value.length <= 1 ? "0" : value.slice(0, -1);
  const next = value === "0" ? key.replace(/^0+/, "") || "0" : value + key;
  return next.length > MAX_DIGITS ? value : next;
}

/**
 * The reference keypad: 1–9, 000, 0 and delete on a surface panel. The key
 * you press flashes lime for 180ms. A hardware keyboard works too.
 */
export function Keypad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const refs = useRef(new Map<Key, HTMLButtonElement>());
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  function flash(key: Key) {
    const el = refs.current.get(key);
    if (!el) return;
    el.classList.remove("key-flash");
    void el.offsetWidth; // restart the animation
    el.classList.add("key-flash");
  }

  function press(key: Key) {
    flash(key);
    onChange(applyKey(valueRef.current, key));
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      let key: Key | null = null;
      if (/^[0-9]$/.test(event.key)) key = event.key as Key;
      else if (event.key === "Backspace") key = "back";
      if (!key) return;
      event.preventDefault();
      press(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- press reads the latest value through a ref
  }, []);

  return (
    <div className="grid grid-cols-3 gap-2 rounded-card bg-surface p-3" role="group" aria-label="Amount keypad">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          ref={(el) => {
            if (el) refs.current.set(key, el);
            else refs.current.delete(key);
          }}
          onClick={() => press(key)}
          aria-label={key === "back" ? "Delete" : key === "000" ? "Three zeros" : key}
          className="press grid h-[54px] place-items-center rounded-key bg-key font-display text-[22px] font-medium tracking-[-0.02em] text-fg"
        >
          {key === "back" ? <Icon name="backspace" size={24} /> : key}
        </button>
      ))}
    </div>
  );
}
