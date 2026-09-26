"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { CheckIcon } from "@/components/icons";
import { QuantityStepper } from "@/components/quantity";
import type { Product } from "@/lib/catalog";
import { formatUsd } from "@/lib/money";
import { MAX_QUANTITY, useShop } from "@/lib/shop-context";

export function PurchasePanel({ product }: { product: Product }) {
  const { add, openDrawer } = useShop();
  const router = useRouter();
  const reduce = useReducedMotion();
  const groupId = useId();
  const [optionId, setOptionId] = useState(product.options[0]!.id);
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const subscription = Boolean(product.recurring);
  const optionLabel = product.options.find((o) => o.id === optionId)?.label;

  const onAdd = () => {
    if (subscription) {
      router.push(`/checkout?subscribe=${product.id}&option=${optionId}`);
      return;
    }
    add(product.id, optionId, quantity);
    setAdded(true);
    timers.current.push(window.setTimeout(openDrawer, reduce ? 0 : 520));
    timers.current.push(window.setTimeout(() => setAdded(false), 2200));
  };

  const many = product.options.length > 4;

  return (
    <div className="mt-8">
      <fieldset>
        <legend className="flex w-full items-baseline justify-between text-[0.92rem]">
          <span className="font-medium">{product.optionLabel}</span>
          <span className="text-muted">{optionLabel}</span>
        </legend>
        <div className={`mt-3 ${many ? "grid grid-cols-5 gap-2 sm:grid-cols-9" : "flex flex-wrap gap-2"}`}>
          {product.options.map((option) => {
            const checked = option.id === optionId;
            return (
              <label
                key={option.id}
                className={`relative inline-flex h-11 cursor-pointer items-center justify-center rounded-full px-4 text-[0.93rem] transition-[box-shadow,background-color] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-sage ${
                  checked ? "bg-ink text-paper" : "shadow-[inset_0_0_0_1px_var(--color-hair-strong)] hover:shadow-[inset_0_0_0_1px_var(--color-ink)]"
                } ${many ? "px-0" : ""}`}
              >
                <input
                  type="radio"
                  name={groupId}
                  value={option.id}
                  checked={checked}
                  onChange={() => setOptionId(option.id)}
                  className="sr-only"
                />
                <span className="num">{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 flex gap-3">
        {subscription ? null : (
          <QuantityStepper label="Quantity" value={quantity} onChange={(q) => setQuantity(Math.max(1, Math.min(MAX_QUANTITY, q)))} max={MAX_QUANTITY} />
        )}
        <button type="button" onClick={onAdd} className="btn btn-ink relative flex-1 overflow-hidden" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {added ? (
              <motion.span
                key="added"
                className="inline-flex items-center gap-2"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <CheckIcon size={18} /> Added to your bag
              </motion.span>
            ) : (
              <motion.span
                key="add"
                className="num inline-flex items-center gap-2"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -14 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                {subscription ? `Subscribe · ${formatUsd(product.price)} a month` : `Add to bag · ${formatUsd(product.price * quantity)}`}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}
